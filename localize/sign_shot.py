"""Issue paired PUT URLs. Signing does not upload an object."""
import argparse
import json
import re
from uuid import uuid4
import boto3
from botocore.config import Config

TTL_SECONDS = 600

def upload_urls(s3, bucket, home, scene):
    if not all(re.fullmatch(r"[A-Za-z0-9_-]+", name) for name in (home, scene)):
        raise ValueError("invalid home or scene")
    stem = f"homes/{home}/shots/{scene}/{uuid4().hex}"
    result = {"expires_in": TTL_SECONDS}
    for field, suffix, mime in [("photo", ".jpg", "image/jpeg"), ("label", ".json", "application/json")]:
        key = stem + suffix
        url = s3.generate_presigned_url("put_object", Params={"Bucket": bucket, "Key": key, "ContentType": mime},
                                        ExpiresIn=TTL_SECONDS, HttpMethod="PUT")
        result[field] = {"url": url, "key": key, "content_type": mime}
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for arg in ("bucket", "home", "scene"):
        parser.add_argument(arg)
    args = parser.parse_args()
    s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
    print(json.dumps(upload_urls(s3, args.bucket, args.home, args.scene)))
