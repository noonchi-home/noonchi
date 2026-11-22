"""Read the private, versioned map for one home; verify before replacing its local cache."""
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path


def checksum(path):
    with path.open("rb") as src:
        return hashlib.file_digest(src, "sha256").hexdigest()


def fetch_latest(client, bucket, home, destination):
    if not re.fullmatch(r"[\w-]+", home):
        raise ValueError("invalid home id")
    prefix = f"homes/{home}/map/"
    body = client.get_object(Bucket=bucket, Key=prefix+"latest.json")["Body"]
    try:
        info = json.loads(body.read(4097))
    finally:
        body.close()
    revision, digest = info["revision"], info["sha256"]
    if not re.fullmatch("[a-f0-9]{16}", revision) or not re.fullmatch("[a-f0-9]{64}", digest):
        raise ValueError("invalid map pointer")
    if destination.is_file() and checksum(destination) == digest:
        return revision
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as target:
        path = Path(target.name)
    try:
        client.download_file(bucket, prefix+revision+".npz", str(path))
        if checksum(path) != digest:
            raise ValueError("map checksum mismatch")
        os.replace(path, destination)
    finally:
        path.unlink(missing_ok=True)
    return revision
