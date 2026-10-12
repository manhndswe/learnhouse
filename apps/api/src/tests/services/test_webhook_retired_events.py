import pytest
from fastapi import HTTPException

from src.db.webhooks import WebhookEndpoint, WebhookEndpointCreate, WebhookEndpointUpdate
from src.services.webhooks import webhooks


@pytest.fixture
async def legacy_endpoint(db, org, admin_user):
    endpoint = WebhookEndpoint(
        webhook_uuid="webhook_legacy_events",
        org_id=org.id,
        url="https://example.com/hook",
        secret_encrypted="test-encrypted-placeholder",
        events=["podcast_episode_created", "course_created"],
        created_by_user_id=admin_user.id,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    db.add(endpoint)
    await db.commit()
    await db.refresh(endpoint)
    return endpoint


@pytest.mark.parametrize("events", [
    ["podcast_episode_created"],
    ["podcast_episode_created", "course_created", "user_signed_up"],
])
async def test_update_discards_only_previously_stored_retired_events(
    events, legacy_endpoint, db, org, admin_user, mock_request, monkeypatch
):
    monkeypatch.setattr(
        webhooks.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )
    updated = await webhooks.update_webhook_endpoint(
        mock_request, db, org.id, legacy_endpoint.webhook_uuid,
        WebhookEndpointUpdate(
            url="https://example.org/updated", events=events,
            description="Updated", is_active=False,
        ),
        admin_user,
    )

    expected = [event for event in events if event != "podcast_episode_created"]
    assert updated.events == expected
    assert updated.description == "Updated"
    assert updated.url == "https://example.org/updated"
    assert updated.is_active is False
    await db.refresh(legacy_endpoint)
    assert legacy_endpoint.events == expected
    assert legacy_endpoint.url == "https://example.org/updated"
    assert legacy_endpoint.secret_encrypted == "test-encrypted-placeholder"
    assert legacy_endpoint.webhook_uuid == "webhook_legacy_events"


async def test_update_still_rejects_new_unknown_events(
    legacy_endpoint, db, org, admin_user, mock_request
):
    with pytest.raises(HTTPException) as exc:
        await webhooks.update_webhook_endpoint(
            mock_request, db, org.id, legacy_endpoint.webhook_uuid,
            WebhookEndpointUpdate(events=["podcast_episode_created", "unknown_future_event"]),
            admin_user,
        )

    assert exc.value.status_code == 400
    assert "unknown_future_event" in exc.value.detail
    await db.refresh(legacy_endpoint)
    assert legacy_endpoint.events == ["podcast_episode_created", "course_created"]


async def test_create_cannot_subscribe_to_retired_events(db, org, admin_user, mock_request):
    with pytest.raises(HTTPException) as exc:
        await webhooks.create_webhook_endpoint(
            mock_request, db, org.id,
            WebhookEndpointCreate(url="https://example.com/hook", events=["podcast_episode_created"]),
            admin_user,
        )

    assert exc.value.status_code == 400
    assert "podcast_episode_created" in exc.value.detail
