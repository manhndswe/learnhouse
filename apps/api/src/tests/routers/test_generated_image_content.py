from io import BytesIO
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers import content_files, local_content
from src.routers.ai.images import _media_path
from src.security.auth import get_current_user


@pytest.mark.parametrize("backend", [local_content, content_files], ids=["local", "s3"])
@pytest.mark.parametrize("viewer", ["anonymous", "admin"])
@pytest.mark.parametrize("method", ["GET", "HEAD"])
async def test_generated_image_content_remains_public(
    backend, viewer, method, db, org, anonymous_user, admin_user, monkeypatch, tmp_path
):
    payload = b"\x89PNG\r\n\x1a\ngenerated-image"
    path = _media_path(org.org_uuid, "generated.png")
    user = anonymous_user if viewer == "anonymous" else admin_user
    app = FastAPI()
    app.include_router(backend.router)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user

    if backend is local_content:
        content_root = tmp_path / "content"
        file_path = content_root / path.removeprefix("content/")
        file_path.parent.mkdir(parents=True)
        file_path.write_bytes(payload)
        monkeypatch.setattr(local_content, "CONTENT_DIR", content_root)
    else:
        storage = Mock()
        storage.head_object.return_value = {"ContentLength": len(payload)}
        storage.get_object.return_value = {"Body": BytesIO(payload)}
        monkeypatch.setattr(content_files, "get_storage_client", lambda: storage)
        monkeypatch.setattr(content_files, "get_s3_bucket_name", lambda: "test-bucket")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(method, f"/{path}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-length"] == str(len(payload))
    assert response.headers["cache-control"].startswith("public")
    assert response.content == (payload if method == "GET" else b"")
    if backend is content_files:
        storage.head_object.assert_called_once_with(Bucket="test-bucket", Key=path)
