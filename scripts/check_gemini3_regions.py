from google.cloud import aiplatform_v1beta1

regions = ["europe-west1", "europe-west4", "us-central1"]

for location in regions:
    try:
        client = aiplatform_v1beta1.ModelGardenServiceClient(
            client_options={"api_endpoint": f"{location}-aiplatform.googleapis.com"}
        )
        models = list(
            client.list_publisher_models(
                request={
                    "parent": "publishers/google",
                    "page_size": 300,
                }
            )
        )
        gemini = sorted([m.name for m in models if "gemini" in m.name.lower()])
        gemini3 = [m for m in gemini if "gemini-3" in m.lower()]

        print(f"[{location}] gemini_count={len(gemini)} gemini3_count={len(gemini3)}")
        for name in gemini:
            print(f"  {name}")
    except Exception as exc:
        print(f"[{location}] ERROR: {exc}")
