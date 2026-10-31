import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import random
import json
import uuid
import pathlib
import asyncio
from typing import Dict, Any, Optional, List

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger()

app = FastAPI(title="WebSocket Game Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load questions from questions.json
QUESTIONS_FILE = pathlib.Path(__file__).parent / "questions.json"
def load_questions() -> List[Dict[str, Any]]:
    if QUESTIONS_FILE.exists():
        with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return [
        {
            "id": 1,
            "text": "{target_name} 最喜歡吃哪種宵夜？",
            "option_a": "炸雞與波霸奶茶",
            "option_b": "健康水果與優格"
        }
    ]

questions_db = load_questions()

def build_questions_by_category(questions: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Build a cached dictionary of questions categorized by their category field."""
    cache: Dict[str, List[Dict[str, Any]]] = {}
    for q in questions:
        cat = q.get("category", "friends")
        if cat not in cache:
            cache[cat] = []
        cache[cat].append(q)
    return cache

questions_by_category = build_questions_by_category(questions_db)

def get_questions_for_category(category: str) -> List[Dict[str, Any]]:
    """Retrieve question pool for specified category with fallback mechanism."""
    pool = questions_by_category.get(category)
    if pool:
        return pool
    # Fallback to 'friends' pool or full questions_db if category is empty/missing
    if "friends" in questions_by_category and questions_by_category["friends"]:
        return questions_by_category["friends"]
    return questions_db

# In-memory data store
rooms: Dict[str, Dict[str, Any]] = {}

def generate_room_code() -> str:
    """Generate a unique 6-digit random room code."""
    while True:
        code = f"{random.randint(100000, 999999)}"
        if code not in rooms:
            return code

def analyze_game_results(room: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Analyze game round results to find perfect_sync and signal_drop questions."""
    target_id = room.get("target_user_id")
    history = room.get("question_history", [])
    if not target_id or not history:
        return {"perfect_sync": None, "signal_drop": None}

    target_p = room["players"].get(target_id, {})
    target_name = target_p.get("name", "主頻率")

    evaluated_questions = []

    for item in history:
        raw_q = item["question"]
        q_order = item["question_order"]
        ans_dict = item["answers"]

        target_choice = ans_dict.get(target_id)  # "A", "B", or "C"

        guessers_choices = [choice for p_id, choice in ans_dict.items() if p_id != target_id]
        total_guessers = len(guessers_choices)

        if target_choice == "A":
            target_choice_key = "option_a"
            target_choice_text = raw_q.get("option_a", "")
        elif target_choice == "B":
            target_choice_key = "option_b"
            target_choice_text = raw_q.get("option_b", "")
        elif target_choice == "C":
            target_choice_key = "option_c"
            target_choice_text = raw_q.get("option_c", "")
        else:
            target_choice_key = "option_a"
            target_choice_text = "未選擇"

        options_distribution = {
            "option_a": sum(1 for c in guessers_choices if c == "A"),
            "option_b": sum(1 for c in guessers_choices if c == "B"),
            "option_c": sum(1 for c in guessers_choices if c == "C"),
        }

        correct_count = sum(1 for c in guessers_choices if c == target_choice) if target_choice else 0
        accuracy_rate = round((correct_count / total_guessers * 100.0), 1) if total_guessers > 0 else 0.0

        q_text = raw_q.get("text", "").replace("{target_name}", target_name)

        evaluated_questions.append({
            "question_id": raw_q.get("id"),
            "question_order": q_order,
            "text": q_text,
            "target_choice_key": target_choice_key,
            "target_choice_text": target_choice_text,
            "accuracy_rate": accuracy_rate,
            "correct_count": correct_count,
            "total_guessers": total_guessers,
            "options_distribution": options_distribution,
            "option_a": raw_q.get("option_a", ""),
            "option_b": raw_q.get("option_b", ""),
            "option_c": raw_q.get("option_c"),
        })

    if not evaluated_questions:
        return {"perfect_sync": None, "signal_drop": None}

    if all(q["total_guessers"] == 0 for q in evaluated_questions):
        return {"perfect_sync": None, "signal_drop": None}

    all_accuracies = [q["accuracy_rate"] for q in evaluated_questions]
    all_same = len(set(all_accuracies)) == 1

    if all_same:
        perfect_sync = evaluated_questions[0]
        signal_drop = evaluated_questions[-1]
    else:
        sorted_for_sync = sorted(evaluated_questions, key=lambda x: (-x["accuracy_rate"], x["question_order"]))
        perfect_sync = sorted_for_sync[0]

        sorted_for_drop = sorted(evaluated_questions, key=lambda x: (x["accuracy_rate"], x["question_order"]))
        signal_drop = sorted_for_drop[0]

    return {
        "perfect_sync": perfect_sync,
        "signal_drop": signal_drop
    }

def get_room_state(room_code: str) -> Optional[Dict[str, Any]]:
    """Return serializable room state without websocket objects."""
    if room_code not in rooms:
        return None
    room = rooms[room_code]
    players_list = []
    for p_id, p_info in room["players"].items():
        players_list.append({
            "id": p_info["id"],
            "name": p_info["name"],
            "is_host": p_info["is_host"],
            "avatar": p_info["avatar"],
            "score": room["scores"].get(p_id, 0)
        })

    current_q = None
    if room["status"] in ["playing", "question_result"] and room["questions"]:
        idx = room["question_index"]
        if idx < len(room["questions"]):
            raw_q = room["questions"][idx]
            target_p = room["players"].get(room["target_user_id"], {})
            target_name = target_p.get("name", "主頻率")
            current_q = {
                "id": raw_q["id"],
                "text": raw_q["text"].replace("{target_name}", target_name),
                "option_a": raw_q["option_a"],
                "option_b": raw_q["option_b"],
                "option_c": raw_q.get("option_c"),
                "total_questions": len(room["questions"]),
                "current_index": idx + 1
            }

    return {
        "code": room["code"],
        "host_id": room["host_id"],
        "status": room["status"],
        "relationship": room.get("relationship", "friends"),
        "target_user_id": room["target_user_id"],
        "question_index": room["question_index"],
        "current_question": current_q,
        "players": players_list,
        "answers": room["answers"],
        "scores": room["scores"],
        "analysis_summary": room.get("analysis_summary")
    }

async def broadcast_to_room(room_code: str, message: Dict[str, Any]):
    """Broadcast JSON message to all connected websockets in the room."""
    if room_code not in rooms:
        return
    room = rooms[room_code]
    for p_id, p_info in list(room["players"].items()):
        ws: WebSocket = p_info["websocket"]
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            pass

async def evaluate_and_advance_question(room_code: str):
    """Evaluate current question answers when all connected players answered."""
    if room_code not in rooms:
        return
    room = rooms[room_code]
    target_id = room["target_user_id"]
    target_answer = room["answers"].get(target_id)

    # Determine correct answer from target user's choice
    correct_choice = target_answer

    current_q_idx = room["question_index"]
    correct_option_text = ""
    if current_q_idx < len(room["questions"]):
        q_info = room["questions"][current_q_idx]
        if correct_choice == "A":
            correct_option_text = q_info.get("option_a", "")
        elif correct_choice == "B":
            correct_option_text = q_info.get("option_b", "")
        elif correct_choice == "C":
            correct_option_text = q_info.get("option_c", "")

        if "question_history" not in room:
            room["question_history"] = []
        room["question_history"].append({
            "question_order": current_q_idx + 1,
            "question": q_info,
            "target_user_id": target_id,
            "answers": dict(room["answers"])
        })

    results = []
    for p_id in room["players"]:
        p_ans = room["answers"].get(p_id)
        is_target = (p_id == target_id)
        is_correct = (p_ans == correct_choice) if (correct_choice and not is_target) else False

        # Target user provides standard answers, so they do not accumulate guessing scores
        if is_correct and not is_target:
            room["scores"][p_id] = room["scores"].get(p_id, 0) + 1

        results.append({
            "player_id": p_id,
            "player_name": room["players"][p_id]["name"],
            "answer": p_ans,
            "is_correct": is_correct,
            "is_target": is_target
        })

    room["status"] = "question_result"

    # Broadcast single question result
    await broadcast_to_room(room_code, {
        "type": "QUESTION_RESULT",
        "correct_choice": correct_choice,
        "correct_option_text": correct_option_text,
        "target_user_id": target_id,
        "target_user_name": room["players"].get(target_id, {}).get("name", "主頻率"),
        "results": results,
        "room_state": get_room_state(room_code)
    })

    # Wait 5.0 seconds so players can comfortably view the round result
    await asyncio.sleep(5.0)

    if room_code not in rooms or room["status"] != "question_result" or len(room["players"]) < 2:
        return

    # Advance to next question or end game
    room["question_index"] += 1
    room["answers"] = {}

    if room["question_index"] >= len(room["questions"]):
        # Game Over
        room["status"] = "game_over"

        analysis_summary = analyze_game_results(room)
        room["analysis_summary"] = analysis_summary

        # Build leaderboard excluding target user from rank score sorting
        guessers = []
        target_item = None

        for p_id, p_info in room["players"].items():
            item = {
                "player_id": p_id,
                "name": p_info["name"],
                "avatar": p_info["avatar"],
                "score": room["scores"].get(p_id, 0),
                "is_target": (p_id == target_id)
            }
            if p_id == target_id:
                target_item = item
            else:
                guessers.append(item)

        guessers_sorted = sorted(guessers, key=lambda x: x["score"], reverse=True)
        leaderboard = ([target_item] if target_item else []) + guessers_sorted

        await broadcast_to_room(room_code, {
            "type": "GAME_OVER",
            "leaderboard": leaderboard,
            "analysis_summary": analysis_summary,
            "room_state": get_room_state(room_code)
        })
    else:
        # Next Question
        room["status"] = "playing"
        await broadcast_to_room(room_code, {
            "type": "QUESTION_START",
            "room_state": get_room_state(room_code)
        })

@app.get("/")
def read_root():
    return {"status": "ok", "message": "WebSocket Game Backend API"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("New WebSocket client connected")

    current_player_id: Optional[str] = None
    current_room_code: Optional[str] = None

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
            except json.JSONDecodeError:
                logger.warning("Received invalid JSON format: %s", raw_data)
                await websocket.send_text(json.dumps({"type": "ERROR", "message": "Invalid JSON format."}))
                continue

            event_type = data.get("type")

            # EVENT: CREATE_ROOM
            if event_type == "CREATE_ROOM":
                player_name = data.get("player_name", "房主玩家")
                avatar = data.get("avatar", "👑")
                relationship = data.get("relationship", "friends")
                if relationship not in ["friends", "new_friends", "family"]:
                    relationship = "friends"

                player_id = str(uuid.uuid4())[:8]

                requested_code = str(data.get("room_code", "")).strip()
                room_code = requested_code if requested_code else generate_room_code()

                rooms[room_code] = {
                    "code": room_code,
                    "host_id": player_id,
                    "status": "waiting",
                    "relationship": relationship,
                    "target_user_id": None,
                    "question_index": 0,
                    "questions": [],
                    "question_history": [],
                    "analysis_summary": None,
                    "players": {
                        player_id: {
                            "id": player_id,
                            "name": player_name,
                            "is_host": True,
                            "avatar": avatar,
                            "websocket": websocket
                        }
                    },
                    "answers": {},
                    "scores": {player_id: 0}
                }

                current_player_id = player_id
                current_room_code = room_code

                await websocket.send_text(json.dumps({
                    "type": "ROOM_CREATED",
                    "room_code": room_code,
                    "player_id": player_id,
                    "room_state": get_room_state(room_code)
                }))

            # EVENT: JOIN_ROOM
            elif event_type == "JOIN_ROOM":
                room_code = str(data.get("room_code", "")).strip()
                player_name = data.get("player_name", "玩家")
                avatar = data.get("avatar", "🦊")

                if room_code not in rooms:
                    logger.warning(f"Failed to join room: Room {room_code} does not exist")
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "message": f"房間 {room_code} 不存在"
                    }))
                    continue

                room = rooms[room_code]
                if room["status"] != "waiting":
                    logger.warning(f"Failed to join room: Game in room {room_code} is already in progress")
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "message": "遊戲進行中，無法加入房間"
                    }))
                    continue

                if len(room["players"]) >= 10:
                    logger.warning(f"Failed to join room: Room {room_code} reached maximum capacity (10 players)")
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "message": "房間人數已達 10 人上限"
                    }))
                    continue

                player_id = str(uuid.uuid4())[:8]

                room["players"][player_id] = {
                    "id": player_id,
                    "name": player_name,
                    "is_host": False,
                    "avatar": avatar,
                    "websocket": websocket
                }
                room["scores"][player_id] = 0

                current_player_id = player_id
                current_room_code = room_code

                logger.info(f"Player {player_name} (ID: {player_id}) successfully joined room {room_code}")

                await websocket.send_text(json.dumps({
                    "type": "ROOM_JOINED",
                    "room_code": room_code,
                    "player_id": player_id,
                    "room_state": get_room_state(room_code)
                }))

                await broadcast_to_room(room_code, {
                    "type": "PLAYER_JOINED",
                    "player_id": player_id,
                    "player_name": player_name,
                    "room_state": get_room_state(room_code)
                })

            # EVENT: SELECT_TARGET
            elif event_type == "SELECT_TARGET":
                if not current_room_code or current_room_code not in rooms:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "未處於有效房間中"}))
                    continue

                room = rooms[current_room_code]
                if room["host_id"] != current_player_id:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "僅房主可指定主頻率"}))
                    continue

                target_id = data.get("target_user_id")
                if target_id and target_id not in room["players"]:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "該主頻率不在房間內"}))
                    continue

                room["target_user_id"] = target_id
                await broadcast_to_room(current_room_code, {
                    "type": "TARGET_SELECTED",
                    "target_user_id": target_id,
                    "room_state": get_room_state(current_room_code)
                })

            # EVENT: UPDATE_RELATIONSHIP
            elif event_type == "UPDATE_RELATIONSHIP":
                if not current_room_code or current_room_code not in rooms:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "未處於有效房間中"}))
                    continue

                room = rooms[current_room_code]
                if room["host_id"] != current_player_id:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "僅房主可切換關係類型"}))
                    continue

                rel = data.get("relationship", "friends")
                if rel not in ["friends", "new_friends", "family"]:
                    rel = "friends"

                room["relationship"] = rel
                await broadcast_to_room(current_room_code, {
                    "type": "RELATIONSHIP_UPDATED",
                    "relationship": rel,
                    "room_state": get_room_state(current_room_code)
                })

            # EVENT: START_GAME
            elif event_type == "START_GAME":
                if not current_room_code or current_room_code not in rooms:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "未處於有效房間中"}))
                    continue

                room = rooms[current_room_code]
                if room["host_id"] != current_player_id:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "僅房主可開始遊戲"}))
                    continue

                if not room["target_user_id"]:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "請先指定主頻率再開始遊戲"}))
                    continue

                room["status"] = "playing"
                room["question_index"] = 0
                rel = room.get("relationship", "friends")
                category_pool = get_questions_for_category(rel)
                num_q = min(10, len(category_pool))
                room["questions"] = random.sample(category_pool, num_q)
                room["question_history"] = []
                room["analysis_summary"] = None
                room["answers"] = {}
                for p_id in room["players"]:
                    room["scores"][p_id] = 0

                await broadcast_to_room(current_room_code, {
                    "type": "QUESTION_START",
                    "room_state": get_room_state(current_room_code)
                })

            # EVENT: SUBMIT_ANSWER
            elif event_type == "SUBMIT_ANSWER":
                if not current_room_code or current_room_code not in rooms:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "未處於有效房間中"}))
                    continue

                room = rooms[current_room_code]
                if room["status"] != "playing":
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "遊戲尚未開始或處於結算狀態"}))
                    continue

                choice = data.get("choice")  # "A", "B", or "C"
                if choice not in ["A", "B", "C"]:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "答案選項格式不符 (需為 A, B 或 C)"}))
                    continue

                room["answers"][current_player_id] = choice

                await broadcast_to_room(current_room_code, {
                    "type": "ANSWER_SUBMITTED",
                    "player_id": current_player_id,
                    "choice": choice,
                    "room_state": get_room_state(current_room_code)
                })

                # If all connected players submitted their answer, evaluate question
                if len(room["answers"]) >= len(room["players"]):
                    await evaluate_and_advance_question(current_room_code)

            else:
                await websocket.send_text(json.dumps({"type": "ERROR", "message": f"未知的事件類型: {event_type}"}))

    except WebSocketDisconnect:
        if current_room_code or current_player_id:
            logger.info(f"WebSocket client disconnected (Player ID: {current_player_id}, Room: {current_room_code})")
        else:
            logger.info("WebSocket client disconnected (Not in any room)")

        if current_room_code and current_room_code in rooms:
            room = rooms[current_room_code]
            if current_player_id in room["players"]:
                leaving_player_name = room["players"][current_player_id]["name"]
                del room["players"][current_player_id]
                room["scores"].pop(current_player_id, None)
                room["answers"].pop(current_player_id, None)

                if len(room["players"]) == 0:
                    del rooms[current_room_code]
                    logger.info(f"All players left. Room {current_room_code} has been destroyed")
                else:
                    if room["host_id"] == current_player_id:
                        new_host_id = next(iter(room["players"]))
                        room["host_id"] = new_host_id
                        room["players"][new_host_id]["is_host"] = True
                        logger.info(f"Host disconnected. Host status for room {current_room_code} transferred to new host ID: {new_host_id}")

                    if room["target_user_id"] == current_player_id:
                        room["target_user_id"] = None

                    await broadcast_to_room(current_room_code, {
                        "type": "PLAYER_LEFT",
                        "player_id": current_player_id,
                        "player_name": leaving_player_name,
                        "room_state": get_room_state(current_room_code)
                    })

                    # Check for game abort threshold: abort game if active and remaining players < 2
                    if room["status"] in ["playing", "question_result"] and len(room["players"]) < 2:
                        room["status"] = "waiting"
                        room["question_index"] = 0
                        room["questions"] = []
                        room["question_history"] = []
                        room["analysis_summary"] = None
                        room["answers"] = {}
                        room["target_user_id"] = None
                        for p_id in room["players"]:
                            room["scores"][p_id] = 0

                        logger.info(f"Game aborted in room {current_room_code} due to insufficient players (< 2 players). State reset to waiting.")

                        await broadcast_to_room(current_room_code, {
                            "type": "GAME_ABORTED",
                            "message": "其他玩家已離開，人數不足無法繼續遊戲",
                            "room_state": get_room_state(current_room_code)
                        })
                    elif room["status"] == "playing" and len(room["answers"]) >= len(room["players"]) and len(room["players"]) > 0:
                        # Check if all remaining players submitted answer
                        await evaluate_and_advance_question(current_room_code)
