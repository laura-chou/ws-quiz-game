import pytest
import json
from fastapi.testclient import TestClient
from main import app, generate_room_code, rooms

@pytest.fixture(autouse=True)
def clear_rooms():
    rooms.clear()
    yield
    rooms.clear()

def test_generate_room_code():
    code = generate_room_code()
    assert len(code) == 6
    assert code.isdigit()

def test_read_root():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "WebSocket Game Backend API"}

def test_websocket_create_room():
    client = TestClient(app)
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({
            "type": "CREATE_ROOM",
            "player_name": "房主 Alice",
            "avatar": "👑",
            "relationship": "new_friends"
        })
        data = websocket.receive_json()
        assert data["type"] == "ROOM_CREATED"
        room_code = data["room_code"]
        assert len(room_code) == 6
        assert room_code in rooms
        assert rooms[room_code]["status"] == "waiting"
        assert rooms[room_code]["relationship"] == "new_friends"
        assert data["room_state"]["relationship"] == "new_friends"

def test_websocket_join_room():
    client = TestClient(app)

    # 1. Host creates room
    with client.websocket_connect("/ws") as host_ws:
        host_ws.send_json({
            "type": "CREATE_ROOM",
            "player_name": "房主 Alice"
        })
        host_res = host_ws.receive_json()
        room_code = host_res["room_code"]

        # 2. Player joins room
        with client.websocket_connect("/ws") as player_ws:
            player_ws.send_json({
                "type": "JOIN_ROOM",
                "room_code": room_code,
                "player_name": "玩家 Bob"
            })
            player_res = player_ws.receive_json()
            assert player_res["type"] == "ROOM_JOINED"
            assert player_res["room_code"] == room_code

            # Host should receive PLAYER_JOINED broadcast
            broadcast_msg = host_ws.receive_json()
            assert broadcast_msg["type"] == "PLAYER_JOINED"
            assert len(broadcast_msg["room_state"]["players"]) == 2

def test_websocket_full_game_flow():
    client = TestClient(app)

    with client.websocket_connect("/ws") as host_ws, client.websocket_connect("/ws") as player_ws:
        # Step 1: Create room
        host_ws.send_json({"type": "CREATE_ROOM", "player_name": "Host"})
        host_created = host_ws.receive_json()
        room_code = host_created["room_code"]
        host_id = host_created["player_id"]

        # Step 2: Join room
        player_ws.send_json({"type": "JOIN_ROOM", "room_code": room_code, "player_name": "Bob"})

        player_joined = player_ws.receive_json() # ROOM_JOINED
        player_id = player_joined["player_id"]

        _player_joined_broadcast = player_ws.receive_json() # PLAYER_JOINED
        _host_joined_broadcast = host_ws.receive_json()     # PLAYER_JOINED

        # Step 3: Select target user (Host only)
        # Attempt select by player -> should fail
        player_ws.send_json({"type": "SELECT_TARGET", "target_user_id": player_id})
        err_res = player_ws.receive_json()
        assert err_res["type"] == "ERROR"

        # Select by host -> should succeed
        host_ws.send_json({"type": "SELECT_TARGET", "target_user_id": player_id})
        target_broadcast_host = host_ws.receive_json()
        target_broadcast_player = player_ws.receive_json()
        assert target_broadcast_host["type"] == "TARGET_SELECTED"
        assert target_broadcast_host["target_user_id"] == player_id

        # Step 4: Start game
        host_ws.send_json({"type": "START_GAME"})
        start_host = host_ws.receive_json()
        start_player = player_ws.receive_json()
        assert start_host["type"] == "QUESTION_START"
        assert start_host["room_state"]["status"] == "playing"
        assert start_host["room_state"]["current_question"] is not None

        # Step 5: Submit answers (both host and player submit)
        player_ws.send_json({"type": "SUBMIT_ANSWER", "choice": "A"})
        ans_player_ws = player_ws.receive_json()
        ans_host_ws = host_ws.receive_json()
        assert ans_player_ws["type"] == "ANSWER_SUBMITTED"
        assert ans_player_ws["choice"] == "A"

        # Host submits answer as target user
        host_ws.send_json({"type": "SUBMIT_ANSWER", "choice": "A"})
        _host_sub = host_ws.receive_json()
        _player_sub = player_ws.receive_json()

        # Both answered -> QUESTION_RESULT received
        q_res_host = host_ws.receive_json()
        q_res_player = player_ws.receive_json()
        assert q_res_host["type"] == "QUESTION_RESULT"
        assert q_res_host["correct_choice"] == "A"

        # Verify host (not target) gets +1 score, while player (target) score remains 0
        room_state = q_res_host["room_state"]
        assert room_state["scores"][host_id] == 1
        assert room_state["scores"][player_id] == 0

def test_join_room_during_game():
    client = TestClient(app)
    with client.websocket_connect("/ws") as host_ws:
        host_ws.send_json({"type": "CREATE_ROOM", "player_name": "Host"})
        host_res = host_ws.receive_json()
        room_code = host_res["room_code"]
        host_id = host_res["player_id"]

        with client.websocket_connect("/ws") as player1_ws:
            player1_ws.send_json({"type": "JOIN_ROOM", "room_code": room_code, "player_name": "Player 1"})
            p1_res = player1_ws.receive_json()
            p1_id = p1_res["player_id"]

            _p1_joined = player1_ws.receive_json()
            _host_joined = host_ws.receive_json()

            # Select target and start game
            host_ws.send_json({"type": "SELECT_TARGET", "target_user_id": p1_id})
            _t_host = host_ws.receive_json()
            _t_p1 = player1_ws.receive_json()

            host_ws.send_json({"type": "START_GAME"})
            _s_host = host_ws.receive_json()
            _s_p1 = player1_ws.receive_json()

            # Now attempt late join by player 2
            with client.websocket_connect("/ws") as late_ws:
                late_ws.send_json({"type": "JOIN_ROOM", "room_code": room_code, "player_name": "Late Joiner"})
                late_res = late_ws.receive_json()
                assert late_res["type"] == "ERROR"
                assert late_res["message"] == "遊戲進行中，無法加入房間"

def test_room_max_players_limit():
    client = TestClient(app)
    with client.websocket_connect("/ws") as host_ws:
        host_ws.send_json({"type": "CREATE_ROOM", "player_name": "Host"})
        host_res = host_ws.receive_json()
        room_code = host_res["room_code"]

        # Directly populate room with 10 players total (1 host + 9 dummy players)
        room = rooms[room_code]
        for i in range(9):
            p_id = f"p_{i}"
            room["players"][p_id] = {
                "id": p_id,
                "name": f"Player {i}",
                "is_host": False,
                "avatar": "🦊",
                "websocket": None
            }

        assert len(room["players"]) == 10

        # Attempt to join 11th player
        with client.websocket_connect("/ws") as extra_ws:
            extra_ws.send_json({
                "type": "JOIN_ROOM",
                "room_code": room_code,
                "player_name": "Extra Player"
            })
            res = extra_ws.receive_json()
            assert res["type"] == "ERROR"
            assert res["message"] == "房間人數已達 10 人上限"

def test_questions_by_category_cache():
    from main import questions_by_category, get_questions_for_category

    assert "friends" in questions_by_category
    assert "new_friends" in questions_by_category
    assert "family" in questions_by_category

    assert len(questions_by_category["friends"]) > 0
    assert len(questions_by_category["new_friends"]) > 0
    assert len(questions_by_category["family"]) > 0

    # Test category question fetching
    family_questions = get_questions_for_category("family")
    assert len(family_questions) == len(questions_by_category["family"])
    assert all(q.get("category") == "family" for q in family_questions)

    # Test invalid category fallback
    fallback_questions = get_questions_for_category("non_existent_category")
    assert len(fallback_questions) > 0

def test_start_game_with_category():
    client = TestClient(app)

    with client.websocket_connect("/ws") as host_ws, client.websocket_connect("/ws") as player_ws:
        # Create room with relationship='family'
        host_ws.send_json({
            "type": "CREATE_ROOM",
            "player_name": "Host",
            "relationship": "family"
        })
        host_created = host_ws.receive_json()
        room_code = host_created["room_code"]

        player_ws.send_json({"type": "JOIN_ROOM", "room_code": room_code, "player_name": "Bob"})
        p_res = player_ws.receive_json()
        player_id = p_res["player_id"]

        _p_joined_bcast = player_ws.receive_json()
        _h_joined_bcast = host_ws.receive_json()

        # Host selects player as target
        host_ws.send_json({"type": "SELECT_TARGET", "target_user_id": player_id})
        _t_host = host_ws.receive_json()
        _t_p = player_ws.receive_json()

        # Host starts game
        host_ws.send_json({"type": "START_GAME"})
        start_host = host_ws.receive_json()
        start_p = player_ws.receive_json()

        assert start_host["type"] == "QUESTION_START"
        # Room questions in backend state should all be from 'family' category pool
        from main import rooms
        room = rooms[room_code]
        assert len(room["questions"]) == 10
        assert all(q.get("category") == "family" for q in room["questions"])

def test_update_relationship():
    client = TestClient(app)
    with client.websocket_connect("/ws") as host_ws:
        host_ws.send_json({
            "type": "CREATE_ROOM",
            "player_name": "Host",
            "relationship": "friends"
        })
        res1 = host_ws.receive_json()
        room_code = res1["room_code"]
        assert res1["room_state"]["relationship"] == "friends"

        # Host updates relationship to family
        host_ws.send_json({
            "type": "UPDATE_RELATIONSHIP",
            "relationship": "family"
        })
        res2 = host_ws.receive_json()
        assert res2["type"] == "RELATIONSHIP_UPDATED"
        assert res2["relationship"] == "family"
        assert res2["room_state"]["relationship"] == "family"

def test_analyze_game_results_basic():
    from main import analyze_game_results

    room = {
        "target_user_id": "target1",
        "players": {
            "target1": {"id": "target1", "name": "Target Player"},
            "p1": {"id": "p1", "name": "Player 1"},
            "p2": {"id": "p2", "name": "Player 2"}
        },
        "question_history": []
    }

    # Populate 10 questions history
    for i in range(1, 11):
        # Target chooses 'A'
        # For Q1: p1 and p2 both choose 'A' -> 100% accuracy
        # For Q10: p1 and p2 both choose 'B' -> 0% accuracy
        # For others: 50% accuracy
        if i == 1:
            ans = {"target1": "A", "p1": "A", "p2": "A"}
        elif i == 10:
            ans = {"target1": "A", "p1": "B", "p2": "B"}
        else:
            ans = {"target1": "A", "p1": "A", "p2": "B"}

        room["question_history"].append({
            "question_order": i,
            "question": {
                "id": i,
                "text": f"Question {i} for {{target_name}}",
                "option_a": "Option A Text",
                "option_b": "Option B Text",
                "option_c": "Option C Text"
            },
            "target_user_id": "target1",
            "answers": ans
        })

    result = analyze_game_results(room)
    assert result is not None
    assert result["perfect_sync"] is not None
    assert result["signal_drop"] is not None

    ps = result["perfect_sync"]
    sd = result["signal_drop"]

    assert ps["question_id"] == 1
    assert ps["accuracy_rate"] == 100.0
    assert ps["correct_count"] == 2
    assert ps["total_guessers"] == 2
    assert ps["options_distribution"] == {"option_a": 2, "option_b": 0, "option_c": 0}
    assert ps["target_choice_key"] == "option_a"
    assert ps["target_choice_text"] == "Option A Text"
    assert "Target Player" in ps["text"]

    assert sd["question_id"] == 10
    assert sd["accuracy_rate"] == 0.0
    assert sd["correct_count"] == 0
    assert sd["total_guessers"] == 2
    assert sd["options_distribution"] == {"option_a": 0, "option_b": 2, "option_c": 0}

def test_analyze_game_results_tie_breaking():
    from main import analyze_game_results

    room = {
        "target_user_id": "target1",
        "players": {
            "target1": {"id": "target1", "name": "Target Player"},
            "p1": {"id": "p1", "name": "Player 1"}
        },
        "question_history": []
    }

    # Q1, Q2, Q3 all 100% accuracy. Tie breaker should select Q1.
    # Q4, Q5 both 0% accuracy. Tie breaker should select Q4.
    for i in range(1, 6):
        if i in [1, 2, 3]:
            ans = {"target1": "A", "p1": "A"}
        else:
            ans = {"target1": "A", "p1": "B"}

        room["question_history"].append({
            "question_order": i,
            "question": {
                "id": i,
                "text": f"Question {i}",
                "option_a": "A",
                "option_b": "B"
            },
            "target_user_id": "target1",
            "answers": ans
        })

    result = analyze_game_results(room)
    assert result["perfect_sync"]["question_id"] == 1
    assert result["signal_drop"]["question_id"] == 4

def test_analyze_game_results_equal_accuracies():
    from main import analyze_game_results

    room = {
        "target_user_id": "target1",
        "players": {
            "target1": {"id": "target1", "name": "Target Player"},
            "p1": {"id": "p1", "name": "Player 1"},
            "p2": {"id": "p2", "name": "Player 2"}
        },
        "question_history": []
    }

    # All 10 questions have 50% accuracy
    for i in range(1, 11):
        room["question_history"].append({
            "question_order": i,
            "question": {
                "id": i,
                "text": f"Question {i}",
                "option_a": "A",
                "option_b": "B"
            },
            "target_user_id": "target1",
            "answers": {"target1": "A", "p1": "A", "p2": "B"}
        })

    result = analyze_game_results(room)
    assert result["perfect_sync"]["question_id"] == 1
    assert result["signal_drop"]["question_id"] == 10

def test_game_aborted_when_player_disconnects():
    client = TestClient(app)

    with client.websocket_connect("/ws") as host_ws:
        host_ws.send_json({"type": "CREATE_ROOM", "player_name": "Host"})
        h_res = host_ws.receive_json()
        room_code = h_res["room_code"]
        host_id = h_res["player_id"]

        with client.websocket_connect("/ws") as player_ws:
            player_ws.send_json({"type": "JOIN_ROOM", "room_code": room_code, "player_name": "Player 1"})
            p_res = player_ws.receive_json()
            player_id = p_res["player_id"]

            _p_bcast = player_ws.receive_json()
            _h_bcast = host_ws.receive_json()

            # Host selects target and starts game
            host_ws.send_json({"type": "SELECT_TARGET", "target_user_id": player_id})
            _t_h = host_ws.receive_json()
            _t_p = player_ws.receive_json()

            host_ws.send_json({"type": "START_GAME"})
            _s_h = host_ws.receive_json()
            _s_p = player_ws.receive_json()

            assert _s_h["room_state"]["status"] == "playing"

            # Player disconnects while game is playing
            # Closing player_ws context triggers WebSocketDisconnect

        # Host should receive PLAYER_LEFT then GAME_ABORTED
        left_msg = host_ws.receive_json()
        assert left_msg["type"] == "PLAYER_LEFT"
        assert left_msg["player_id"] == player_id

        abort_msg = host_ws.receive_json()
        assert abort_msg["type"] == "GAME_ABORTED"
        assert abort_msg["message"] == "其他玩家已離開，人數不足無法繼續遊戲"
        assert abort_msg["room_state"]["status"] == "waiting"
        assert abort_msg["room_state"]["target_user_id"] is None
        assert abort_msg["room_state"]["current_question"] is None
        assert abort_msg["room_state"]["question_index"] == 0
        assert abort_msg["room_state"]["scores"][host_id] == 0

        # Room state in memory
        room = rooms[room_code]
        assert room["status"] == "waiting"
        assert room["target_user_id"] is None
        assert room["question_index"] == 0
        assert room["questions"] == []
        assert room["answers"] == {}
        assert len(room["players"]) == 1

def test_analyze_game_results_zero_guessers():
    from main import analyze_game_results

    room = {
        "target_user_id": "target1",
        "players": {
            "target1": {"id": "target1", "name": "Target Player"}
        },
        "question_history": []
    }

    # Single player target user with no guessers
    for i in range(1, 11):
        room["question_history"].append({
            "question_order": i,
            "question": {
                "id": i,
                "text": f"Question {i}",
                "option_a": "A",
                "option_b": "B"
            },
            "target_user_id": "target1",
            "answers": {"target1": "A"}
        })

    result = analyze_game_results(room)
    assert result["perfect_sync"] is None
    assert result["signal_drop"] is None
