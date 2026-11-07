"""Contract checks use local fixtures, not actual model predictions."""

from copy import deepcopy
import json
import unittest

from pam.contracts import (
    ContractError,
    parse_prediction,
    validate_memory,
    validate_observation_records,
    validate_prediction,
    validate_tasks,
)


class TaskAndMemoryTests(unittest.TestCase):
    def setUp(self):
        self.memory = {
            "initial_state": "active",
            "states": [
                {
                    "id": "active",
                    "description": "A person is using a workspace.",
                    "rules": [{"trigger": "A spare tool is needed.", "action": "Offer the spare tool."}],
                    "next": [{"to": "done", "on": "The person leaves the workspace."}],
                },
                {"id": "done", "description": "The workspace is empty.", "rules": [], "next": []},
            ],
        }

    def test_tasks_require_nonempty_array_and_nonblank_strings(self):
        for value in ([], "Offer a tool", [""], ["  "], [None], [3], [True]):
            with self.subTest(value=value), self.assertRaises(ContractError):
                validate_tasks(value)
        self.assertEqual(validate_tasks(["Offer a tool"]), ["Offer a tool"])

    def test_memory_accepts_empty_rules_and_terminal_transitions_without_mutation(self):
        original = deepcopy(self.memory)
        self.assertEqual(validate_memory(self.memory, "fsm"), original)
        self.assertEqual(self.memory, original)
        self.assertEqual(validate_memory({"rules": []}, "list"), {"rules": []})

    def test_memory_rejects_duplicate_or_unknown_state_identifiers(self):
        for defect in ("duplicate", "initial", "destination"):
            memory = deepcopy(self.memory)
            if defect == "duplicate":
                memory["states"][1]["id"] = "active"
            elif defect == "initial":
                memory["initial_state"] = "unknown"
            else:
                memory["states"][0]["next"][0]["to"] = "unknown"
            with self.subTest(defect=defect), self.assertRaises(ContractError):
                validate_memory(memory, "fsm")

    def test_memory_rejects_wrong_shape_or_evaluation_fields(self):
        cases = []
        for path in ("root", "state", "rule", "transition"):
            memory = deepcopy(self.memory)
            target = {
                "root": memory,
                "state": memory["states"][0],
                "rule": memory["states"][0]["rules"][0],
                "transition": memory["states"][0]["next"][0],
            }[path]
            target["expected_action"] = "Offer a tool"
            cases.append(memory)
        cases.extend([
            {"initial_state": "active", "states": []},
            {"days": [], "transitions": []},
            {"initial_state": "active", "states": [{"id": "active"}]},
        ])
        for memory in cases:
            with self.subTest(memory=memory), self.assertRaises(ContractError):
                validate_memory(memory, "fsm")

    def test_list_memory_and_kind_are_distinct(self):
        memory = {"rules": [{"trigger": "A tool is needed.", "action": "Offer a tool."}]}
        self.assertEqual(validate_memory(memory, "list"), memory)
        for value, kind in ((memory, "fsm"), (self.memory, "list"), (memory, "unknown")):
            with self.subTest(kind=kind), self.assertRaises(ContractError):
                validate_memory(value, kind)
        with self.assertRaises(ContractError):
            validate_memory({"rules": [{"trigger": "A tool is needed.", "action": " "}]}, "list")


class PredictionTests(unittest.TestCase):
    def setUp(self):
        self.tasks = ["Offer a tool", "Put a tool in storage"]
        self.prediction = {"observation": "A person is seated.", "reasoning": "A tool is needed.", "task_index": 0}

    def test_action_mapping_and_raw_response_preservation(self):
        raw = "\n" + json.dumps(self.prediction, indent=2) + "\n"
        result = parse_prediction(raw, self.tasks)
        self.assertEqual(result, {
            "status": "valid", "raw_response": raw, "prediction": self.prediction,
            "selected_action": self.tasks[0], "errors": [],
        })

    def test_valid_wait_is_not_an_invalid_response(self):
        self.prediction["task_index"] = -1
        result = parse_prediction(json.dumps(self.prediction), self.tasks)
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["prediction"]["task_index"], -1)
        self.assertIsNone(result["selected_action"])
        self.assertEqual(result["errors"], [])

    def test_bad_action_indices_never_become_wait(self):
        for index in (True, False, 0.0, "0", -2, 2, None):
            prediction = dict(self.prediction, task_index=index)
            raw = json.dumps(prediction)
            with self.subTest(index=index):
                result = parse_prediction(raw, self.tasks)
                self.assertEqual(result["status"], "invalid")
                self.assertIsNone(result["prediction"])
                self.assertIsNone(result["selected_action"])
                self.assertTrue(result["errors"])
                self.assertEqual(result["raw_response"], raw)

    def test_strict_json_rejects_duplicates_nonfinite_numbers_and_repairs(self):
        valid = json.dumps(self.prediction)
        raws = [
            '{"observation":"x","reasoning":"y","task_index":-1,"task_index":0}',
            '{"observation":"x","observation":"z","reasoning":"y","task_index":0}',
            '{"observation":"x","reasoning":"y","task_index":NaN}',
            '{"observation":"x","reasoning":"y","task_index":Infinity}',
            '{"observation":"x","reasoning":"y","task_index":-Infinity}',
            f"```json\n{valid}\n```", f"Here is the result: {valid}",
            valid + valid, "{", "null", "[]", "",
        ]
        for raw in raws:
            with self.subTest(raw=raw):
                result = parse_prediction(raw, self.tasks)
                self.assertEqual(result["status"], "invalid")
                self.assertEqual(result["raw_response"], raw)
                self.assertIsNone(result["prediction"])
                self.assertTrue(result["errors"])

    def test_exact_response_fields_and_nonempty_text(self):
        cases = [dict(self.prediction, confidence=0.9), {"task_index": 0}]
        for field in ("observation", "reasoning"):
            for value in ("", "  ", None, 1):
                cases.append(dict(self.prediction, **{field: value}))
        for prediction in cases:
            with self.subTest(prediction=prediction), self.assertRaises(ContractError):
                validate_prediction(prediction, self.tasks)


class ObservationContractTests(unittest.TestCase):
    def setUp(self):
        self.records = [
            {"timestamp": "2026-10-24T08:00:00+09:00", "left_image": "left_0.png", "right_image": "right_0.png"},
            {"timestamp": "2026-10-24T08:00:01+09:00", "left_image": "left_1.png", "right_image": "right_1.png"},
        ]

    def test_array_and_manifest_preserve_original_records_without_reading_files(self):
        original = deepcopy(self.records)
        self.assertEqual(validate_observation_records(self.records), original)
        self.assertEqual(validate_observation_records({"observations": self.records}), original)
        self.assertEqual(self.records, original)

    def test_timezone_offsets_are_compared_as_absolute_instants(self):
        records = deepcopy(self.records)
        records[1]["timestamp"] = "2026-10-23T23:00:01Z"
        self.assertEqual(validate_observation_records(records), records)
        records[1]["timestamp"] = "2026-10-23T23:00:00Z"
        with self.assertRaises(ContractError):
            validate_observation_records(records)

    def test_missing_camera_and_evaluation_label_are_rejected(self):
        for change in ("missing", "extra", "blank"):
            records = deepcopy(self.records)
            if change == "missing":
                del records[0]["right_image"]
            elif change == "extra":
                records[0]["expected_action"] = "Offer a tool"
            else:
                records[0]["left_image"] = " "
            with self.subTest(change=change), self.assertRaises(ContractError):
                validate_observation_records(records)
        with self.assertRaises(ContractError):
            validate_observation_records({"observations": self.records, "expected_action": "Offer a tool"})

    def test_timestamps_must_be_valid_aware_sorted_and_unique(self):
        for timestamp in ("not-a-time", "2026-10-24T08:00:01", "2026-10-24", "2026-10-24T07:59:59+09:00", "2026-10-24T08:00:00+09:00"):
            records = deepcopy(self.records)
            records[1]["timestamp"] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaises(ContractError):
                validate_observation_records(records)
        for value in ([], {}, {"observations": []}, {"observations": "not-an-array"}):
            with self.subTest(value=value), self.assertRaises(ContractError):
                validate_observation_records(value)


if __name__ == "__main__":
    unittest.main()
