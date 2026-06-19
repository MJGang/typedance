def test_allows_packaged_tauri_origin(client):
    response = client.get(
        "/documents",
        headers={"Origin": "http://tauri.localhost"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"
