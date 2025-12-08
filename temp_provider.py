from services.creative_providers import OpenAICreativeProvider, StubCreativeProvider
from services.ai_creative import _build_stub_engine
provider = OpenAICreativeProvider(model='gpt-4o-mini', timeout_s=25, max_tokens=2000, fallback_provider=StubCreativeProvider(_build_stub_engine))
try:
    result = provider.generate('System vyhodnoti test. Ak je uspesny, HR pripravi ponuku. Inak HR odosle zamietnutie.', 'sk', 50, 'engine_json')
    print(result)
except Exception as exc:
    import traceback
    traceback.print_exc()
