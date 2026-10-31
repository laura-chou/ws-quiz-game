"use client";

import Link from "next/link";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toPng } from "html-to-image";
import { evaluateChemistry } from "../utils/resultUtils";

interface Player {
  id: string;
  name: string;
  is_host: boolean;
  avatar: string;
  score: number;
}

interface Question {
  id: number;
  text: string;
  option_a: string;
  option_b: string;
  option_c?: string | null;
  total_questions: number;
  current_index: number;
}

interface AnalysisQuestion {
  question_id: number;
  question_order?: number;
  text: string;
  target_choice_key: string;
  target_choice_text: string;
  accuracy_rate: number;
  correct_count: number;
  total_guessers: number;
  options_distribution: {
    option_a: number;
    option_b: number;
    option_c: number;
  };
  option_a?: string;
  option_b?: string;
  option_c?: string | null;
}

interface AnalysisSummary {
  perfect_sync: AnalysisQuestion | null;
  signal_drop: AnalysisQuestion | null;
}

interface RoomState {
  code: string;
  host_id: string;
  status: "waiting" | "playing" | "question_result" | "game_over";
  relationship?: string;
  target_user_id: string | null;
  question_index: number;
  current_question: Question | null;
  players: Player[];
  answers: Record<string, string>;
  scores: Record<string, number>;
  analysis_summary?: AnalysisSummary | null;
}

interface QuestionResultItem {
  player_id: string;
  player_name: string;
  answer: string | null;
  is_correct: boolean;
  is_target: boolean;
}

interface QuestionResult {
  correct_choice: string | null;
  correct_option_text: string;
  target_user_id: string;
  target_user_name: string;
  results: QuestionResultItem[];
  room_state: RoomState;
}

interface LeaderboardItem {
  player_id: string;
  name: string;
  avatar: string;
  score: number;
  is_target: boolean;
}

function renderOptionsDistribution(q: AnalysisQuestion) {
  const total = q.total_guessers || 1;
  const opts = [
    {
      key: "option_a",
      label: "選項 A",
      text: q.option_a || (q.target_choice_key === "option_a" ? q.target_choice_text : ""),
      count: q.options_distribution?.option_a || 0,
    },
    {
      key: "option_b",
      label: "選項 B",
      text: q.option_b || (q.target_choice_key === "option_b" ? q.target_choice_text : ""),
      count: q.options_distribution?.option_b || 0,
    },
  ];

  if (
    q.option_c ||
    (q.options_distribution?.option_c !== undefined &&
      (q.options_distribution.option_c > 0 || q.target_choice_key === "option_c"))
  ) {
    opts.push({
      key: "option_c",
      label: "選項 C",
      text: q.option_c || (q.target_choice_key === "option_c" ? q.target_choice_text : ""),
      count: q.options_distribution?.option_c || 0,
    });
  }

  return (
    <div className="space-y-1.5 pt-1">
      <div className="text-[11px] text-slate-400 font-medium">全場玩家選擇分布：</div>
      <div className="flex flex-col gap-2">
        {opts.map((opt) => {
          const isTarget = q.target_choice_key === opt.key;
          const pct = Math.round((opt.count / total) * 100);
          return (
            <div
              key={opt.key}
              className={`p-3 rounded-xl border text-xs flex flex-col gap-1.5 ${
                isTarget
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 font-bold"
                  : "bg-gray-800/60 border-gray-700/50 text-slate-300"
              }`}
            >
              {/* Row 1: Option Label (Left) vs Badge & Votes (Right) */}
              <div className="flex items-center justify-between w-full">
                <span className="font-mono text-[11px] font-bold">
                  {opt.label}
                </span>

                <div className="flex items-center gap-2">
                  {isTarget && (
                    <span className="text-[10px] bg-emerald-500/30 px-1.5 py-0.5 rounded text-emerald-200 font-bold border border-emerald-500/40">
                      正解
                    </span>
                  )}
                  <span className="font-mono text-xs font-bold text-slate-100">
                    {opt.count} 人 ({pct}%)
                  </span>
                </div>
              </div>

              {/* Row 2: Full Option Text Description */}
              {opt.text && (
                <div className="text-slate-200 font-medium leading-relaxed break-words text-left">
                  {opt.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisSummarySection({
  summary,
}: {
  summary: AnalysisSummary | null;
  totalPlayers?: number;
}) {
  if (!summary) return null;
  const { perfect_sync, signal_drop } = summary;
  if (!perfect_sync && !signal_drop) return null;

  return (
    <div className="space-y-3.5 pt-3 text-left border-t border-slate-800/80">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
          <span>📡</span>
          <span>深度同頻分析</span>
        </h4>
        <span className="text-[10px] text-slate-500">對比全場作答亮點</span>
      </div>

      <div className="space-y-3">
        {/* 完美同頻帶 */}
        {perfect_sync && (
          <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-2xl p-4 space-y-2.5 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-300 bg-emerald-500/20 px-2.5 py-1 rounded-full border border-emerald-500/30">
                <span>🎯</span>
                <span>完美同頻帶</span>
              </span>
            </div>

            <p className="text-xs sm:text-sm font-extrabold text-slate-100 leading-relaxed break-words">
              {perfect_sync.text}
            </p>

            {renderOptionsDistribution(perfect_sync)}
          </div>
        )}

        {/* 訊號中斷帶 */}
        {signal_drop && (
          <div className="bg-rose-950/30 border border-rose-500/40 rounded-2xl p-4 space-y-2.5 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-xs font-black text-rose-300 bg-rose-500/20 px-2.5 py-1 rounded-full border border-rose-500/30">
                <span>⚡</span>
                <span>訊號中斷帶</span>
              </span>
            </div>

            <p className="text-xs sm:text-sm font-extrabold text-slate-100 leading-relaxed break-words">
              {signal_drop.text}
            </p>

            {renderOptionsDistribution(signal_drop)}
          </div>
        )}
      </div>
    </div>
  );
}

function RoomLobbyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const roomCode = searchParams.get("code") || "123456";
  const isHostParam = searchParams.get("isHost") === "true";
  const currentUserName = searchParams.get("name") || "玩家";
  const currentUserAvatar = searchParams.get("avatar") || "🦊";
  const relationshipParam = searchParams.get("relationship") || "friends";

  // WebSocket & State
  const [isConnected, setIsConnected] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [lastQuestionResult, setLastQuestionResult] = useState<QuestionResult | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultCountdown, setResultCountdown] = useState<number>(5);

  const socketRef = useRef<WebSocket | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Dynamic countdown timer for single question result state
  useEffect(() => {
    if (roomState?.status === "question_result") {
      const interval = setInterval(() => {
        setResultCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [roomState?.status, roomState?.question_index]);

  // Initialize WebSocket connection
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setHasConnected(true);
      setErrorMsg(null);

      if (isHostParam) {
        ws.send(
          JSON.stringify({
            type: "CREATE_ROOM",
            room_code: roomCode,
            player_name: currentUserName,
            relationship: relationshipParam,
            avatar: currentUserAvatar,
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "JOIN_ROOM",
            room_code: roomCode,
            player_name: currentUserName,
            avatar: currentUserAvatar,
          })
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type;

        if (type === "ROOM_CREATED") {
          setPlayerId(data.player_id);
          setRoomState(data.room_state);
        } else if (type === "ROOM_JOINED") {
          setPlayerId(data.player_id);
          setRoomState(data.room_state);
        } else if (
          type === "PLAYER_JOINED" ||
          type === "TARGET_SELECTED" ||
          type === "PLAYER_LEFT" ||
          type === "RELATIONSHIP_UPDATED"
        ) {
          setRoomState(data.room_state);
        } else if (type === "QUESTION_START") {
          setRoomState(data.room_state);
          setLastQuestionResult(null);
        } else if (type === "ANSWER_SUBMITTED") {
          setRoomState(data.room_state);
        } else if (type === "QUESTION_RESULT") {
          setRoomState(data.room_state);
          setLastQuestionResult(data);
          setResultCountdown(5);
        } else if (type === "GAME_OVER") {
          setRoomState(data.room_state);
          setLeaderboard(data.leaderboard);
          if (data.analysis_summary) {
            setAnalysisSummary(data.analysis_summary);
          } else if (data.room_state?.analysis_summary) {
            setAnalysisSummary(data.room_state.analysis_summary);
          }
        } else if (type === "GAME_ABORTED") {
          setRoomState(data.room_state);
          setLastQuestionResult(null);
          setErrorMsg(data.message || "其他玩家已離開，人數不足無法繼續遊戲");
        } else if (type === "ERROR") {
          const msg = data.message || "發生錯誤";
          setErrorMsg(msg);
        }
      } catch (err) {
        console.error("Failed to parse websocket message:", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [roomCode, isHostParam, currentUserName, currentUserAvatar, relationshipParam]);

  // Actions
  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectRelationship = (rel: string) => {
    if (!socketRef.current || !roomState) return;
    if (roomState.host_id !== playerId) return;

    socketRef.current.send(
      JSON.stringify({
        type: "UPDATE_RELATIONSHIP",
        relationship: rel,
      })
    );
  };

  const handleSelectTarget = (targetId: string) => {
    if (!socketRef.current || !roomState) return;
    if (roomState.host_id !== playerId) return;

    socketRef.current.send(
      JSON.stringify({
        type: "SELECT_TARGET",
        target_user_id: targetId,
      })
    );
  };

  const handleStartGame = () => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "START_GAME",
      })
    );
  };

  const handleSubmitAnswer = (choice: "A" | "B" | "C") => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "SUBMIT_ANSWER",
        choice: choice,
      })
    );
  };

  // Image Download Function
  const handleDownloadCard = async () => {
    if (!cardRef.current) return;
    try {
      setIsDownloading(true);
      const dataUrl = await toPng(cardRef.current, { cacheBust: true });
      const link = document.createElement("a");
      link.download = `quiz-result-${roomCode}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Download card image failed:", err);
      setErrorMsg("圖片導出失敗，請重試");
    } finally {
      setIsDownloading(false);
    }
  };

  const isHost = roomState ? roomState.host_id === playerId : isHostParam;
  const targetPlayer = roomState?.players.find(
    (p) => p.id === roomState.target_user_id
  );
  const myPlayer = roomState?.players.find((p) => p.id === playerId);
  const myAnswer = roomState?.answers[playerId || ""];
  const totalPlayers = roomState?.players.length || 0;
  const answeredCount = roomState ? Object.keys(roomState.answers).length : 0;
  const totalQuestionsCount = roomState?.current_question?.total_questions || 10;

  const currentRelationship = roomState?.relationship || "friends";
  const isTargetUser = playerId === roomState?.target_user_id;

  const myEvaluation = evaluateChemistry(
    myPlayer?.score || 0,
    totalQuestionsCount,
    currentRelationship
  );

  const activeAnalysisSummary = analysisSummary || roomState?.analysis_summary || null;

  // Prevent accidental page leave / reload during active game
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (
        roomState?.status === "playing" ||
        roomState?.status === "question_result"
      ) {
        e.preventDefault();
        (e as unknown as { returnValue: string }).returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [roomState?.status]);

  return (
    <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 sm:p-8 space-y-6 animate-fadeIn transition-all">
      {/* Full-Screen Disconnect Overlay Modal */}
      {hasConnected && !isConnected && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 max-w-sm w-full text-center space-y-4">
            <div className="text-4xl animate-bounce">⚠️</div>
            <h2 className="text-lg font-bold text-slate-100">連線已中斷</h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              與伺服器連線已中斷，請重新加入房間。
            </p>
            <Link
              href="/"
              className="w-full block text-center bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold py-3.5 px-5 rounded-xl shadow-lg transition-all text-sm"
            >
              返回首頁
            </Link>
          </div>
        </div>
      )}

      {/* Custom Error Modal Overlay */}
      {errorMsg && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 max-w-sm w-full text-center space-y-4">
            <div className="text-4xl animate-bounce">⚠️</div>
            <h2 className="text-lg font-bold text-slate-100">提示資訊</h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {errorMsg}
            </p>
            <button
              onClick={() => {
                setErrorMsg(null);
                router.push("/");
              }}
              className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold py-3.5 px-5 rounded-xl shadow-lg transition-all text-sm"
            >
              確定
            </button>
          </div>
        </div>
      )}

      {/* Room Header - Shown only in waiting state */}
      {roomState?.status === "waiting" && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 uppercase font-semibold">
                房間號碼
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                大廳狀態
              </span>
              {currentRelationship === "friends" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  🍻 好友
                </span>
              )}
              {currentRelationship === "new_friends" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-teal-500/10 text-teal-300 border border-teal-500/20">
                  🆕 新朋友
                </span>
              )}
              {currentRelationship === "family" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  ❤️ 家人
                </span>
              )}
            </div>
            <div className="text-3xl font-mono font-extrabold text-indigo-400 tracking-widest mt-0.5">
              {roomCode}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={handleCopyCode}
              className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2.5 rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
            >
              <span>{copied ? "✓ 已複製" : "📋 複製房號"}</span>
            </button>
            <button
              onClick={() => router.push("/")}
              className="flex-1 sm:flex-none bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold px-4 py-2.5 rounded-lg border border-rose-800/40 transition-colors flex items-center justify-center gap-1.5"
            >
              <span>離開</span>
            </button>
          </div>
        </div>
      )}

      {/* STATE 1: LOBBY WAITING */}
      {roomState?.status === "waiting" && (
        <div className="space-y-5 animate-fadeIn">
          {/* Host Relationship Selection in Lobby */}
          {isHost && (
            <div className="space-y-2 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800">
              <label className="block text-xs font-semibold text-slate-300">
                設定房間關係類型
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectRelationship("friends")}
                  className={`py-2 px-2 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    currentRelationship === "friends"
                      ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 font-bold"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <span>🍻</span>
                  <span>好友</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectRelationship("new_friends")}
                  className={`py-2 px-2 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    currentRelationship === "new_friends"
                      ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <span>🆕</span>
                  <span>新朋友</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectRelationship("family")}
                  className={`py-2 px-2 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    currentRelationship === "family"
                      ? "bg-amber-600/20 border-amber-500 text-amber-300 font-bold"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <span>❤️</span>
                  <span>家人</span>
                </button>
              </div>
            </div>
          )}

          {/* Players List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <span>👥 玩家列表</span>
                <span className="text-xs font-normal text-slate-500">
                  ({roomState.players.length} 人)
                </span>
              </h2>
              {isHost && (
                <span className="text-xs text-amber-400/90 font-medium">
                  💡 點擊玩家設為主頻率
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {roomState.players.map((player) => {
                const isSelected = roomState.target_user_id === player.id;
                return (
                  <div
                    key={player.id}
                    onClick={() => handleSelectTarget(player.id)}
                    className={`relative flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      isHost ? "cursor-pointer hover:border-indigo-500/60" : ""
                    } ${
                      isSelected
                        ? "bg-amber-500/10 border-amber-500 shadow-md shadow-amber-500/10"
                        : "bg-slate-950/60 border-slate-800"
                    }`}
                  >
                    <div className="text-2xl bg-slate-800 p-2 rounded-xl">
                      {player.avatar}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm text-slate-200 truncate">
                          {player.name}
                        </span>
                        {player.is_host && (
                          <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            房主
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="text-[11px] font-bold text-amber-400 mt-0.5 flex items-center gap-1">
                          <span>🎯</span>
                          <span>主頻率</span>
                        </div>
                      )}
                    </div>

                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 text-xs font-bold flex items-center justify-center">
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <hr className="border-slate-800" />

          {/* Controls */}
          {isHost ? (
            <div className="space-y-3 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                  👑 房主控制台
                </span>
                <span className="text-xs text-slate-400">
                  {targetPlayer
                    ? `已選擇主頻率: ${targetPlayer.name}`
                    : "請點選一位玩家作為主頻率"}
                </span>
              </div>

              <button
                onClick={handleStartGame}
                disabled={!roomState.target_user_id}
                className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold py-3.5 px-6 rounded-xl shadow-lg transition-all transform active:scale-[0.99] flex items-center justify-center gap-2 text-base"
              >
                <span>🚀</span>
                <span>開始遊戲</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 bg-slate-950/40 p-5 rounded-xl border border-slate-800 text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-400 mb-1 animate-spin">
                ⏳
              </div>
              <h3 className="text-sm font-bold text-slate-200">
                等待房主開始遊戲...
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                房主正在挑選主頻率，請做好作答準備！
              </p>
            </div>
          )}
        </div>
      )}

      {/* STATE 2: PLAYING (QUIZ) */}
      {roomState?.status === "playing" && roomState.current_question && (
        <div className="space-y-6 animate-fadeIn">
          {/* Question Header Progress */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
              第 {roomState.current_question.current_index} /{" "}
              {roomState.current_question.total_questions} 題
            </span>
            <span className="text-xs text-slate-400">
              主頻率:{" "}
              <strong className="text-amber-400">
                {targetPlayer?.avatar} {targetPlayer?.name}
              </strong>
            </span>
          </div>

          {/* Question Stem */}
          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 text-center space-y-2">
            <p className="text-lg sm:text-xl font-extrabold text-slate-100 leading-relaxed">
              {roomState.current_question.text}
            </p>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 gap-3.5">
            <button
              type="button"
              onClick={() => handleSubmitAnswer("A")}
              className={`p-4 rounded-xl border text-left font-bold transition-all flex items-center justify-between gap-3 ${
                myAnswer === "A"
                  ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 ring-2 ring-indigo-500/50"
                  : "bg-slate-950 hover:bg-slate-800 border-slate-800 hover:border-indigo-500 text-slate-200 active:scale-[0.99]"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 font-mono font-black flex items-center justify-center shrink-0">
                  A
                </span>
                <span className="text-sm sm:text-base leading-relaxed break-words">
                  {roomState.current_question.option_a}
                </span>
              </div>
              {myAnswer === "A" && (
                <div className="w-6 h-6 rounded-full bg-indigo-500 text-slate-950 text-xs font-black flex items-center justify-center shrink-0 shadow">
                  ✓
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSubmitAnswer("B")}
              className={`p-4 rounded-xl border text-left font-bold transition-all flex items-center justify-between gap-3 ${
                myAnswer === "B"
                  ? "bg-purple-600/30 border-purple-500 text-purple-200 ring-2 ring-purple-500/50"
                  : "bg-slate-950 hover:bg-slate-800 border-slate-800 hover:border-indigo-500 text-slate-200 active:scale-[0.99]"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 font-mono font-black flex items-center justify-center shrink-0">
                  B
                </span>
                <span className="text-sm sm:text-base leading-relaxed break-words">
                  {roomState.current_question.option_b}
                </span>
              </div>
              {myAnswer === "B" && (
                <div className="w-6 h-6 rounded-full bg-purple-500 text-slate-950 text-xs font-black flex items-center justify-center shrink-0 shadow">
                  ✓
                </div>
              )}
            </button>

            {roomState.current_question.option_c && (
              <button
                type="button"
                onClick={() => handleSubmitAnswer("C")}
                className={`p-4 rounded-xl border text-left font-bold transition-all flex items-center justify-between gap-3 ${
                  myAnswer === "C"
                    ? "bg-teal-600/30 border-teal-500 text-teal-200 ring-2 ring-teal-500/50"
                    : "bg-slate-950 hover:bg-slate-800 border-slate-800 hover:border-indigo-500 text-slate-200 active:scale-[0.99]"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 font-mono font-black flex items-center justify-center shrink-0">
                    C
                  </span>
                  <span className="text-sm sm:text-base leading-relaxed break-words">
                    {roomState.current_question.option_c}
                  </span>
                </div>
                {myAnswer === "C" && (
                  <div className="w-6 h-6 rounded-full bg-teal-500 text-slate-950 text-xs font-black flex items-center justify-center shrink-0 shadow">
                    ✓
                  </div>
                )}
              </button>
            )}
          </div>

          {/* Submission Status Footer */}
          <div className="bg-slate-950/50 p-3.5 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              {myAnswer
                ? "已選擇答案，在公佈結果前可隨時切換選項"
                : "請點擊上方選項完成作答"}
            </span>
            <span className="font-mono text-indigo-400 font-bold">
              作答進度: {answeredCount} / {totalPlayers}
            </span>
          </div>
        </div>
      )}

      {/* STATE 3: QUESTION RESULT */}
      {roomState?.status === "question_result" && lastQuestionResult && (
        <div className="space-y-5 animate-fadeIn">
          {/* Visual 5s Countdown Timer */}
          <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-2xl flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                <span>⏱️</span>
                <span>即將進入下一階段...</span>
              </span>
              <span className="bg-indigo-500/20 text-indigo-300 font-mono font-bold px-2.5 py-0.5 rounded-full border border-indigo-500/30 text-xs flex items-center gap-1">
                <span>{resultCountdown}</span>
                <span>秒</span>
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-amber-400 h-1.5 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${(resultCountdown / 5) * 100}%` }}
              />
            </div>
          </div>

          {/* All-Options Unified Breakdown Section */}
          <div className="space-y-3 text-left">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <span>📊</span>
                <span>全選項比對解析</span>
              </h4>
              <span className="text-[11px] text-slate-400">
                主頻率{" "}
                <strong className="text-amber-400 font-bold">
                  {lastQuestionResult.target_user_name}
                </strong>
              </span>
            </div>

            {/* Display Question Stem */}
            {roomState?.current_question?.text && (
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-slate-200 text-xs sm:text-sm font-bold leading-relaxed">
                {roomState.current_question.text}
              </div>
            )}

            <div className="space-y-3">
              {(() => {
                const currQ = roomState?.current_question;
                const guessers = lastQuestionResult.results.filter(
                  (res) =>
                    !res.is_target && res.player_id !== lastQuestionResult.target_user_id
                );

                // Option keys A, B, C
                const optionKeys: Array<{ key: "A" | "B" | "C"; label: string; text?: string | null }> = [
                  { key: "A", label: "選項 A", text: currQ?.option_a },
                  { key: "B", label: "選項 B", text: currQ?.option_b },
                ];
                if (currQ?.option_c) {
                  optionKeys.push({ key: "C", label: "選項 C", text: currQ.option_c });
                }

                // Map all options without filtering out unchosen ones
                const optionGroups = optionKeys.map((opt) => {
                  const playersInGroup = guessers.filter((g) => g.answer === opt.key);
                  return {
                    ...opt,
                    players: playersInGroup,
                  };
                });

                // Group unanswered players
                const unansweredPlayers = guessers.filter((g) => !g.answer);

                return (
                  <>
                    {/* Render cards for ALL options */}
                    {optionGroups.map((group) => {
                      const isCorrectGroup = lastQuestionResult.correct_choice === group.key;

                      return (
                        <div
                          key={group.key}
                          className={`p-3.5 rounded-2xl border text-xs space-y-2.5 transition-all ${
                            isCorrectGroup
                              ? "bg-emerald-950/40 border-emerald-500/60 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/30"
                              : "bg-slate-950/80 border-slate-800/90"
                          }`}
                        >
                          {/* Card Top / Header: Option Label (Left) & Option Text Description */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-mono text-[11px] font-black px-2.5 py-0.5 rounded-md border uppercase ${
                                    isCorrectGroup
                                      ? "bg-emerald-500/30 text-emerald-200 border-emerald-500/50 shadow"
                                      : "bg-slate-800 text-slate-300 border-slate-700"
                                  }`}
                                >
                                  {group.label}
                                </span>
                                {isCorrectGroup && (
                                  <span className="text-[10px] bg-emerald-500/40 text-emerald-200 font-extrabold px-2 py-0.5 rounded-md border border-emerald-400/50 uppercase tracking-wider">
                                    🎯 正解
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-400 font-mono font-semibold">
                                {group.players.length} 人選擇
                              </span>
                            </div>

                            {group.text && (
                              <p className={`text-xs sm:text-sm font-bold leading-relaxed break-words pt-1 ${
                                isCorrectGroup ? "text-emerald-100" : "text-slate-200"
                              }`}>
                                {group.text}
                              </p>
                            )}
                          </div>

                          {/* Card Sub-list: Grouped Players List */}
                          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5">
                            {group.players.length > 0 ? (
                              group.players.map((p) => (
                                <div
                                  key={p.player_id}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${
                                    p.is_correct
                                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200 font-bold"
                                      : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                                  }`}
                                >
                                  <span>{p.player_name}</span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.2 rounded font-black ${
                                      p.is_correct
                                        ? "bg-emerald-500/40 text-emerald-100"
                                        : "bg-rose-500/30 text-rose-200"
                                    }`}
                                  >
                                    {p.is_correct ? "猜對" : "猜錯"}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <span className="text-[11px] text-slate-500 italic">
                                尚無玩家選擇此選項
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Render Unanswered Section if any player failed to answer */}
                    {unansweredPlayers.length > 0 && (
                      <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-950/60 text-xs space-y-2">
                        <div className="flex items-center justify-between text-slate-400 font-semibold">
                          <span>未作答玩家</span>
                          <span className="font-mono">{unansweredPlayers.length} 人</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {unansweredPlayers.map((p) => (
                            <span
                              key={p.player_id}
                              className="px-2.5 py-1 bg-slate-900 border border-slate-800 text-slate-400 rounded-lg"
                            >
                              {p.player_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* STATE 4: GAME OVER (LEADERBOARD & RESULT CARD) */}
      {roomState?.status === "game_over" && (
        <div className="space-y-6 text-center animate-fadeIn">
          {/* Target User Screen (你是主頻率) vs Guessing Player Screen */}
          {isTargetUser ? (
            <div
              ref={cardRef}
              className="bg-gradient-to-b from-amber-950/40 via-slate-950 to-indigo-950 p-6 sm:p-8 rounded-3xl border border-amber-500/40 text-center space-y-6 shadow-2xl"
            >
              <div className="flex justify-center items-center text-xs text-amber-400 border-b border-amber-500/20 pb-3">
                <span className="font-extrabold tracking-wider uppercase flex items-center gap-1">
                  <span>📡 頻率同步結果</span>
                </span>
              </div>

              <div className="space-y-3 py-2">
                <div className="text-5xl my-2">🎉</div>
                <p className="text-xs sm:text-sm text-slate-300 max-w-sm mx-auto leading-relaxed font-medium">
                  感謝你擔任本場的「主頻率」！你分享的獨特信號讓這局遊戲充滿驚喜！快來看看是誰成功接收、成為與你頻率最同步的人吧！
                </p>
              </div>

              <hr className="border-slate-800/80" />

              {/* Emotional Reflective Quote (Family & Friends only) */}
              {(currentRelationship === "family" || currentRelationship === "friends") && (
                <div className="bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-pink-500/10 border border-amber-500/30 rounded-2xl p-4 text-center shadow-md">
                  <p className="text-xs sm:text-sm font-bold text-amber-200 leading-relaxed">
                    💡 不妨想想，你們是真的熟識彼此，還是只是認識比較久？
                  </p>
                </div>
              )}

              {/* Leaderboard for Target User */}
              <div className="space-y-3 text-left">
                <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <span>📊</span>
                  <span>排行榜</span>
                </h4>
                <div className="space-y-2">
                  {leaderboard
                    .filter((item) => item.player_id !== roomState.target_user_id)
                    .map((item, rank) => {
                      const evalResult = evaluateChemistry(
                        item.score,
                        totalQuestionsCount,
                        currentRelationship
                      );
                      return (
                        <div
                          key={item.player_id}
                          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs ${
                            rank === 0
                              ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
                              : "bg-slate-900/80 border-slate-800 text-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-extrabold text-sm w-4 text-slate-400">
                              #{rank + 1}
                            </span>
                            <span className="text-xl">{item.avatar}</span>
                            <div>
                              <div className="font-bold text-slate-200">
                                {item.name}
                              </div>
                              <div className="text-[10px] text-indigo-300 font-medium">
                                {evalResult.badge} {evalResult.title}
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="font-black text-amber-400 text-sm">
                              {evalResult.percentage}% 默契
                            </div>
                            <div className="text-[10px] text-slate-500">
                              答對 {item.score} / {totalQuestionsCount} 題
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Analysis summary card section for Target User */}
              <AnalysisSummarySection
                summary={activeAnalysisSummary}
                totalPlayers={totalPlayers}
              />
            </div>
          ) : (
            /* Guessing Player Share Card */
            <div
              ref={cardRef}
              className="bg-gradient-to-b from-slate-900 via-slate-950 to-indigo-950 p-6 sm:p-8 rounded-3xl border border-indigo-500/40 text-center space-y-5 shadow-2xl"
            >
              {/* Header Badge */}
              <div className="flex justify-center items-center text-xs text-indigo-400 border-b border-indigo-500/20 pb-3">
                <span className="font-extrabold tracking-wider uppercase">
                  📡 頻率同步結果
                </span>
              </div>

              {/* Chemistry Evaluation Main Banner */}
              <div className="space-y-2 py-2">
                <div className="text-5xl my-2">{myEvaluation.badge}</div>
                <div className="text-xs font-bold text-slate-400">
                  與{" "}
                  <span className="text-amber-400 font-extrabold">
                    {targetPlayer?.name || "主頻率"}
                  </span>{" "}
                  的默契指數
                </div>
                <div className="text-4xl sm:text-5xl font-black bg-gradient-to-r from-amber-300 via-indigo-300 to-pink-300 bg-clip-text text-transparent">
                  {myEvaluation.percentage}%
                </div>
                <div className="inline-block bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full">
                  {myEvaluation.title}
                </div>
                <p className="text-xs text-slate-300 px-4 pt-1 italic">
                  “{myEvaluation.comment}”
                </p>
              </div>

              <hr className="border-slate-800/80" />

              {/* Emotional Reflective Quote (Family & Friends only) */}
              {(currentRelationship === "family" || currentRelationship === "friends") && (
                <div className="bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-pink-500/10 border border-amber-500/30 rounded-2xl p-4 text-center shadow-md">
                  <p className="text-xs sm:text-sm font-bold text-amber-200 leading-relaxed">
                    💡 不妨想想，你們是真的熟識彼此，還是只是認識比較久？
                  </p>
                </div>
              )}

              {/* Leaderboard Section in Card */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-400 text-left flex items-center gap-1.5">
                  <span>📊</span>
                  <span>排行榜</span>
                </h4>
                <div className="space-y-2">
                  {leaderboard.map((item, rank) => {
                    const isMe = item.player_id === playerId;
                    const isItemTarget = item.player_id === roomState.target_user_id || item.is_target;
                    return (
                      <div
                        key={item.player_id}
                        className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                          isItemTarget
                            ? "bg-amber-500/10 border-amber-500/40 text-amber-200 font-bold"
                            : rank === (leaderboard.some(x => x.is_target || x.player_id === roomState.target_user_id) ? 1 : 0)
                            ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
                            : isMe
                            ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-200 font-bold"
                            : "bg-slate-900/80 border-slate-800 text-slate-300"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-extrabold w-4 text-slate-400">
                            {isItemTarget ? "🎯" : `#${rank}`}
                          </span>
                          <span className="text-lg">{item.avatar}</span>
                          <span>{item.name}</span>
                          {isItemTarget && (
                            <span className="bg-amber-500/30 text-amber-300 text-[10px] px-1.5 py-0.5 rounded font-bold">
                              主頻率
                            </span>
                          )}
                          {isMe && !isItemTarget && (
                            <span className="bg-indigo-500/30 text-indigo-300 text-[10px] px-1.5 py-0.5 rounded">
                              我
                            </span>
                          )}
                        </div>
                        <span className="font-mono font-bold text-indigo-400">
                          {isItemTarget ? "" : `${item.score} / ${totalQuestionsCount} 分`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Analysis summary card section for Guessers */}
              <AnalysisSummarySection
                summary={activeAnalysisSummary}
                totalPlayers={totalPlayers}
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            <button
              onClick={handleDownloadCard}
              disabled={isDownloading}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold py-3 px-5 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm"
            >
              <span>📸</span>
              <span>{isDownloading ? "導出中..." : "下載結果"}</span>
            </button>

            <button
              onClick={() => router.push("/")}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-6 rounded-xl border border-slate-700 transition-colors text-sm"
            >
              離開
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RoomPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6">
      <Suspense fallback={<div className="text-slate-400">載入大廳中...</div>}>
        <RoomLobbyContent />
      </Suspense>
    </main>
  );
}
