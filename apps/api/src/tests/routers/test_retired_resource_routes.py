import pytest
from httpx import ASGITransport, AsyncClient

from app import app
from src.db.organization_config import OrgFeatureConfig
from src.db.roles import Rights


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/podcasts/",
        "/api/v1/podcasts/podcast_retired/episodes",
        "/api/v1/orgs/1/config/podcasts",
        "/api/v1/stream/audio/org_retired/podcast_retired/episode_retired/audio.mp3",
    ],
)
async def test_retired_resource_routes_are_not_registered(path):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(path)
    assert response.status_code == 404


def test_resource_catalog_excludes_retired_feature_and_keeps_lesson_audio():
    spec = app.openapi()
    assert not any("podcast" in path.lower() for path in spec["paths"])
    assert not any(
        "podcast" in name.lower() for name in spec["components"]["schemas"]
    )
    assert "podcasts" not in OrgFeatureConfig.model_fields
    assert "podcasts" not in Rights.model_fields
    assert "/api/v1/ai/audio/generate" in spec["paths"]
    assert "/api/v1/ai/audio/script" in spec["paths"]
    stream_path = "/api/v1/stream/block/audio/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename}"
    assert "get" in spec["paths"][stream_path]
    assert "head" in spec["paths"][stream_path]
