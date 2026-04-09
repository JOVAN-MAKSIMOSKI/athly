from google.cloud import aiplatform_v1beta1

LOCATION = "europe-west1"
PUBLISHER = "google"

print("start", flush=True)
print(f"Listing publisher models in region '{LOCATION}' for publisher '{PUBLISHER}'...", flush=True)

try:
    client = aiplatform_v1beta1.ModelGardenServiceClient(
        client_options={"api_endpoint": f"{LOCATION}-aiplatform.googleapis.com"}
    )
    parent = f"publishers/{PUBLISHER}"

    pager = client.list_publisher_models(
        request={
            "parent": parent,
            "page_size": 300,
        }
    )
    publisher_models = list(pager)
    print(f"list_ok count={len(publisher_models)}", flush=True)

    sorted_models = sorted(
        [m for m in publisher_models if "gemini" in m.name.lower()],
        key=lambda m: m.name,
        reverse=True,
    )

    for model in sorted_models:
        print(f"  - Model ID: {model.name}", flush=True)
except Exception as e:
    print(f"Error listing models in {LOCATION}: {e}", flush=True)
