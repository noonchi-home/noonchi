import unittest
from urllib.parse import parse_qs, urlparse
import boto3
from botocore.config import Config
from sign_shot import upload_urls


class ShotSigning(unittest.TestCase):
    def test_offline_sigv4_pair(self):
        client=boto3.client("s3",region_name="ap-northeast-2",aws_access_key_id="example",
                            aws_secret_access_key="test-only",config=Config(signature_version="s3v4"))
        result=upload_urls(client,"test-bucket","one","kitchen_C")
        for field,extension,mime in [("photo",".jpg","image/jpeg"),("label",".json","application/json")]:
            item=result[field]
            url=urlparse(item["url"])
            query=parse_qs(url.query)
            self.assertEqual(query["X-Amz-Expires"],["600"])
            self.assertEqual(query["X-Amz-Algorithm"],["AWS4-HMAC-SHA256"])
            self.assertEqual(query["X-Amz-SignedHeaders"],["content-type;host"])
            self.assertTrue(url.path.endswith(item["key"]))
            self.assertTrue(item["key"].startswith("homes/one/shots/kitchen_C/"))
            self.assertTrue(item["key"].endswith(extension))
            self.assertEqual(item["content_type"],mime)
        self.assertEqual(result["photo"]["key"][:-4],result["label"]["key"][:-5])
        self.assertNotEqual(upload_urls(client,"test-bucket","one","kitchen_C")["photo"]["key"],result["photo"]["key"])
