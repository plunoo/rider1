import { useEffect, useMemo, useState } from "react";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";
import { useAuth } from "../../auth/AuthContext";

type Thread = {
  user_id: number;
  name: string;
  role?: string | null;
  store?: string | null;
  last_message?: string | null;
  last_at?: string | null;
  unread_count?: number;
};

type Message = {
  id: number;
  sender_id: number;
  recipient_id: number;
  body: string;
  image_url?: string | null;
  image_mime?: string | null;
  created_at?: string | null;
  read_at?: string | null;
};

type Recipient = {
  id: number;
  name: string;
  role?: string | null;
  store?: string | null;
  is_active?: boolean;
};

type ConversationResponse = {
  items: Message[];
  total: number;
  limit: number;
  offset: number;
};

type Props = {
  variant?: "admin" | "rider";
};

const formatTime = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "";
  return d.toLocaleTimeString();
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "";
  return d.toLocaleDateString();
};

const avatarPalette = ["#0ea5a4", "#22c55e", "#3b82f6", "#f97316", "#ef4444", "#0ea5e9", "#14b8a6", "#64748b"];

const getAvatarColor = (id?: number) => {
  if (!id || id < 0) return avatarPalette[0];
  return avatarPalette[id % avatarPalette.length];
};

const getInitials = (name?: string | null) => {
  const safe = (name || "").trim();
  if (!safe) return "?";
  return safe.slice(0, 1).toUpperCase();
};

export default function MessagesPage({ variant = "admin" }: Props) {
  const { user } = useAuth();
  const isRider = variant === "rider";
  const [threads, setThreads] = useState<Thread[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [composeNew, setComposeNew] = useState(false);
  const maxImageMb = 5;

  const loadThreads = async () => {
    const res = await api.get<Thread[]>("/messages/threads");
    setThreads(res.data || []);
  };

  const loadRecipients = async () => {
    const res = await api.get<Recipient[]>("/messages/recipients");
    setRecipients(res.data || []);
  };

  const loadConversation = async (otherId: number) => {
    const res = await api.get<ConversationResponse>(`/messages/with/${otherId}`, { params: { limit: 60, offset: 0 } });
    setMessages(res.data.items || []);
  };

  const loadAll = async () => {
    setLoading(true);
    setErr(null);
    try {
      await Promise.all([loadThreads(), loadRecipients()]);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load messages"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (selectedId != null) {
      loadConversation(selectedId);
    }
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachment(null);
    setAttachmentPreview(null);
  }, [selectedId]);

  useEffect(() => {
    if (attachmentPreview) {
      return () => {
        URL.revokeObjectURL(attachmentPreview);
      };
    }
    return undefined;
  }, [attachmentPreview]);

  useEffect(() => {
    if (selectedId == null && threads.length > 0) {
      if (composeNew) return;
      setSelectedId(threads[0].user_id);
    }
  }, [threads, selectedId, composeNew]);

  const startCompose = () => {
    setSelectedId(null);
    setComposeNew(true);
    setRecipientId("");
    setMessages([]);
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachment(null);
    setAttachmentPreview(null);
  };

  const totalUnread = useMemo(
    () => threads.reduce((acc, t) => acc + (t.unread_count || 0), 0),
    [threads]
  );

  const threadList = useMemo(() => {
    const q = threadQuery.trim().toLowerCase();
    let list = threads.slice();
    if (q) {
      list = list.filter((t) => {
        const hay = [t.name, t.role, t.store, t.last_message].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    if (unreadOnly) {
      list = list.filter((t) => (t.unread_count || 0) > 0);
    }
    return list.sort((a, b) => {
      const au = a.unread_count || 0;
      const bu = b.unread_count || 0;
      if (au !== bu) return bu - au;
      const at = a.last_at ? new Date(a.last_at).getTime() : 0;
      const bt = b.last_at ? new Date(b.last_at).getTime() : 0;
      return bt - at;
    });
  }, [threads, threadQuery, unreadOnly]);

  const activeThread = useMemo(() => threads.find((t) => t.user_id === selectedId) || null, [threads, selectedId]);
  const otherName = activeThread?.name || "";

  const sendMessage = async () => {
    const targetId = selectedId ?? (recipientId ? Number(recipientId) : null);
    if (!targetId) {
      setErr("Choose a recipient.");
      return;
    }
    if (!body.trim() && !attachment) {
      setErr("Message cannot be empty.");
      return;
    }
    setSending(true);
    setErr(null);
    try {
      if (attachment) {
        const form = new FormData();
        form.append("recipient_id", String(targetId));
        if (body.trim()) form.append("body", body.trim());
        form.append("image", attachment);
        await api.post("/messages/send", form);
      } else {
        await api.post("/messages/send", { recipient_id: targetId, body });
      }
      setBody("");
      setAttachment(null);
      if (attachmentPreview) {
        URL.revokeObjectURL(attachmentPreview);
        setAttachmentPreview(null);
      }
    if (!selectedId) {
      setSelectedId(targetId);
      setRecipientId("");
      setComposeNew(false);
    }
    await loadThreads();
    await loadConversation(targetId);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to send message"));
    } finally {
      setSending(false);
    }
  };

  const emptyMessages = selectedId == null || messages.length === 0;

  const resolveMediaUrl = (url?: string | null) => {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    const base = (api.defaults.baseURL || "").replace(/\/$/, "");
    return `${base}${url}`;
  };

  const threadPanelStyle = isRider
    ? {
        ...threadPanel,
        background: "rgba(255, 255, 255, 0.92)",
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: "0 18px 34px rgba(15, 23, 42, 0.18)",
        backdropFilter: "blur(8px)",
      }
    : threadPanel;
  const messagePanelStyle = isRider
    ? {
        ...messagePanel,
        background: "rgba(255, 255, 255, 0.92)",
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: "0 18px 34px rgba(15, 23, 42, 0.18)",
        backdropFilter: "blur(8px)",
      }
    : messagePanel;

  const content = (
    <div style={{ display: "grid", gap: 14 }}>
      {variant === "admin" && <Topbar title="Messages" />}

      {variant === "rider" && (
        <div className="rider-card">
          <div className="rider-card-title">Messages</div>
          <div className="rider-card-subtitle">Chat with admins and store captains.</div>
        </div>
      )}

      {err && <div style={alert}>{err}</div>}
      {loading && <div style={alert}>Loading messages...</div>}

      <div style={layout}>
        <div style={threadPanelStyle}>
          <div style={panelHeader}>
            <div>
              <div style={panelLabel}>Conversations</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={panelTitle}>Inbox</div>
                {totalUnread > 0 && <span style={unreadPill}>{totalUnread}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={ghostBtn} onClick={startCompose}>New message</button>
              <button style={ghostBtn} onClick={loadAll}>Refresh</button>
            </div>
          </div>

          <div style={threadTools}>
            <input
              style={searchInput}
              placeholder="Search conversations"
              value={threadQuery}
              onChange={(e) => setThreadQuery(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={!unreadOnly ? chipBtnActive : chipBtn} onClick={() => setUnreadOnly(false)}>
                All
              </button>
              <button style={unreadOnly ? chipBtnActive : chipBtn} onClick={() => setUnreadOnly(true)}>
                Unread
              </button>
            </div>
          </div>

          {threadList.length === 0 ? (
            <div style={empty}>No conversations yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {threadList.map((t) => (
                <button
                  key={t.user_id}
                  style={{
                    ...threadRow,
                    ...(t.user_id === selectedId ? threadRowActive : {}),
                    background: isRider
                      ? t.user_id === selectedId
                        ? "rgba(14, 165, 164, 0.12)"
                        : "rgba(255, 255, 255, 0.85)"
                      : (t.user_id === selectedId ? threadRowActive.background : threadRow.background),
                  }}
                  onClick={() => {
                    setSelectedId(t.user_id);
                    setComposeNew(false);
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ ...threadAvatar, background: getAvatarColor(t.user_id) }}>
                      {getInitials(t.name)}
                    </div>
                    <div style={threadBody}>
                      <div style={threadTop}>
                        <div style={threadName}>{t.name}</div>
                        <div style={threadTime}>{formatDate(t.last_at)}</div>
                      </div>
                      <div style={threadMeta}>{t.role || ""}{t.store ? ` - ${t.store}` : ""}</div>
                      <div style={threadPreview}>{t.last_message || "No messages yet."}</div>
                    </div>
                  </div>
                  {t.unread_count ? <div style={unread}>{t.unread_count}</div> : <div style={readDot} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={messagePanelStyle}>
          <div style={panelHeader}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ ...threadAvatar, width: 40, height: 40, fontSize: 16, background: getAvatarColor(selectedId || 0) }}>
                {activeThread ? getInitials(activeThread.name) : "?"}
              </div>
              <div>
                <div style={panelLabel}>{activeThread ? "Conversation" : "New message"}</div>
                <div style={panelTitle}>{activeThread ? otherName : "Select recipient"}</div>
                <div style={threadMeta}>
                  {activeThread?.role || ""}{activeThread?.store ? ` - ${activeThread.store}` : ""}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={ghostBtn} onClick={loadAll}>Refresh</button>
              <button style={ghostBtn} onClick={startCompose}>New</button>
            </div>
          </div>

          {!activeThread && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <select style={input} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
                <option value="">Select recipient</option>
                {recipients.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name} ({r.role}){r.store ? ` - ${r.store}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={messageList}>
            {emptyMessages ? (
              <div style={empty}>No messages yet.</div>
            ) : (
              (() => {
                let lastDate = "";
                return messages.map((m) => {
                  const isMine = String(m.sender_id) === String(user?.id);
                  const dateLabel = formatDate(m.created_at);
                  const showDate = dateLabel && dateLabel !== lastDate;
                  if (showDate) lastDate = dateLabel;
                  const imageUrl = resolveMediaUrl(m.image_url);
                  return (
                    <div key={m.id} style={{ display: "grid", gap: 6 }}>
                      {showDate && <div style={dateDivider}>{dateLabel}</div>}
                      <div style={{ ...bubbleRow, justifyContent: isMine ? "flex-end" : "flex-start" }}>
                        <div
                          style={{
                            ...bubble,
                            background: isMine ? "linear-gradient(135deg,#2563eb,#10b981)" : "#f1f5f9",
                            color: isMine ? "white" : "#0f172a",
                            boxShadow: isMine ? "0 12px 26px rgba(37, 99, 235, 0.2)" : "none",
                          }}
                        >
                          {imageUrl && (
                            <img
                              src={imageUrl}
                              alt="Attachment"
                              style={{
                                maxWidth: 240,
                                borderRadius: 12,
                                display: "block",
                                marginBottom: m.body ? 6 : 0,
                              }}
                            />
                          )}
                          {m.body && <div style={{ lineHeight: 1.4 }}>{m.body}</div>}
                          <div style={bubbleMeta}>{formatTime(m.created_at)}</div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>

          <div style={composer}>
            <textarea
              style={textarea}
              rows={3}
              placeholder="Type a message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!sending) sendMessage();
                }
              }}
            />
            <div style={attachmentRow}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={attachmentLabel}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (!file) return;
                      if (!file.type.startsWith("image/")) {
                        setErr("Only images are allowed.");
                        return;
                      }
                      if (file.size > maxImageMb * 1024 * 1024) {
                        setErr(`Image must be under ${maxImageMb}MB.`);
                        return;
                      }
                      if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
                      setAttachment(file);
                      setAttachmentPreview(URL.createObjectURL(file));
                      setErr(null);
                    }}
                  />
                  Attach image
                </label>
                {attachment && (
                  <button
                    style={ghostBtn}
                    onClick={() => {
                      if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
                      setAttachment(null);
                      setAttachmentPreview(null);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              {attachmentPreview && <img src={attachmentPreview} alt="Preview" style={attachmentPreviewStyle} />}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={threadMeta}>Logged in as {user?.name || "User"}</div>
              <button style={primaryBtn} onClick={sendMessage} disabled={sending}>
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (variant === "rider") {
    return <div className="rider-stack rider-messages">{content}</div>;
  }
  return content;
}

const layout: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 14,
  alignItems: "start",
};

const threadPanel: React.CSSProperties = {
  background: "white",
  borderRadius: 16,
  padding: 14,
  border: "1px solid #e2e8f0",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
  display: "grid",
  gap: 12,
};

const messagePanel: React.CSSProperties = {
  background: "white",
  borderRadius: 16,
  padding: 14,
  border: "1px solid #e2e8f0",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
  display: "grid",
  gap: 12,
};

const panelHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const panelLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.65 };
const panelTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800 };

const unreadPill: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  background: "#fee2e2",
  color: "#b91c1c",
  fontSize: 12,
  fontWeight: 800,
};

const threadTools: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const searchInput: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  fontSize: 13,
  fontWeight: 600,
};

const chipBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const chipBtnActive: React.CSSProperties = {
  ...chipBtn,
  background: "linear-gradient(135deg,#2563eb,#10b981)",
  borderColor: "transparent",
  color: "white",
};

const threadRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  padding: "12px",
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  cursor: "pointer",
  textAlign: "left",
  transition: "transform 0.12s ease, box-shadow 0.2s ease, border-color 0.2s ease",
};

const threadRowActive: React.CSSProperties = {
  borderColor: "rgba(37, 99, 235, 0.5)",
  boxShadow: "0 14px 30px rgba(37, 99, 235, 0.18)",
  transform: "translateY(-1px)",
  background: "#f8fafc",
};

const threadAvatar: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 12,
  color: "white",
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  flexShrink: 0,
};

const threadBody: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const threadTop: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const threadName: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 14,
  color: "#0f172a",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const threadTime: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  flexShrink: 0,
};

const threadMeta: React.CSSProperties = { fontSize: 11, color: "#64748b" };
const threadPreview: React.CSSProperties = {
  fontSize: 12,
  color: "#334155",
  opacity: 0.9,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const readDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: "#e2e8f0",
  marginLeft: 8,
  flexShrink: 0,
};

const unread: React.CSSProperties = {
  minWidth: 18,
  height: 18,
  padding: "0 6px",
  borderRadius: 999,
  background: "#ef4444",
  color: "white",
  fontSize: 11,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const messageList: React.CSSProperties = {
  minHeight: 280,
  maxHeight: 460,
  overflowY: "auto",
  display: "grid",
  gap: 10,
  padding: 10,
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
};

const bubbleRow: React.CSSProperties = {
  display: "flex",
};

const bubble: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 16,
  maxWidth: "75%",
  display: "grid",
  gap: 4,
};

const bubbleMeta: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.7,
};

const dateDivider: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  padding: "4px 0",
};

const composer: React.CSSProperties = {
  display: "grid",
  gap: 8,
  borderTop: "1px solid #e5e7eb",
  paddingTop: 10,
};

const attachmentRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const attachmentLabel: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const attachmentPreviewStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 10,
  objectFit: "cover",
  border: "1px solid #e2e8f0",
};

const textarea: React.CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: "10px 12px",
  fontFamily: "inherit",
  fontSize: 13,
  background: "#f8fafc",
};

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 12,
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: 0,
  color: "white",
  background: "linear-gradient(135deg,#2563eb,#10b981)",
  fontWeight: 800,
  cursor: "pointer",
};

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};

const empty: React.CSSProperties = {
  padding: 12,
  border: "1px dashed #e5e7eb",
  borderRadius: 10,
  textAlign: "center",
  color: "#6b7280",
};
