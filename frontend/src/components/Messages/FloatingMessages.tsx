import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";
import { useAuth } from "../../auth/AuthContext";
import { useMessageThreads } from "../../hooks/useMessageThreads";
import { playMessageSound } from "../../utils/sound";

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

const formatTime = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "";
  return d.toLocaleTimeString();
};

export default function FloatingMessages() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { threads, unreadTotal, refresh: refreshThreads } = useMessageThreads({
    pollMs: 12000,
    onUnreadIncrease: () => playMessageSound(),
  });
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [composeNew, setComposeNew] = useState(false);
  const lastMessageByThreadRef = useRef<Record<number, number>>({});
  const maxImageMb = 5;

  const loadRecipients = async () => {
    try {
      const res = await api.get<Recipient[]>("/messages/recipients");
      setRecipients(res.data || []);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load recipients"));
    }
  };

  const loadConversation = async (otherId: number) => {
    try {
      const res = await api.get<ConversationResponse>(`/messages/with/${otherId}`, { params: { limit: 60, offset: 0 } });
      const next = res.data.items || [];
      setMessages(next);
      const last = next[next.length - 1];
      if (last) {
        const prevId = lastMessageByThreadRef.current[otherId];
        if (prevId != null && last.id > prevId && String(last.sender_id) !== String(user?.id)) {
          playMessageSound();
        }
        lastMessageByThreadRef.current[otherId] = last.id;
      }
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load messages"));
    }
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr(null);
    Promise.all([refreshThreads(), loadRecipients()])
      .catch((e) => setErr(getApiErrorMessage(e, "Failed to load messages")))
      .finally(() => setLoading(false));
  }, [open, refreshThreads]);

  useEffect(() => {
    if (!open || selectedId == null) return;
    loadConversation(selectedId).then(() => refreshThreads());
    const id = setInterval(() => {
      loadConversation(selectedId).then(() => refreshThreads());
    }, 8000);
    return () => clearInterval(id);
  }, [open, selectedId, refreshThreads]);

  useEffect(() => {
    if (!open) return;
    if (selectedId == null && threads.length > 0) {
      if (composeNew) return;
      setSelectedId(threads[0].user_id);
    }
  }, [open, threads, selectedId, composeNew]);

  useEffect(() => {
    if (attachmentPreview) {
      return () => {
        URL.revokeObjectURL(attachmentPreview);
      };
    }
    return undefined;
  }, [attachmentPreview]);

  useEffect(() => {
    if (open) return;
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachment(null);
    setAttachmentPreview(null);
  }, [open, attachmentPreview]);

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
      }
      await refreshThreads();
      await loadConversation(targetId);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to send message"));
    } finally {
      setSending(false);
    }
  };

  const threadButtons = useMemo(() => threads.slice(0, 8), [threads]);

  const resolveMediaUrl = (url?: string | null) => {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    const base = (api.defaults.baseURL || "").replace(/\/$/, "");
    return `${base}${url}`;
  };

  return (
    <div className="floating-messages">
      {!open && (
        <button className="floating-messages-btn" onClick={() => setOpen(true)}>
          Messages
          {unreadTotal > 0 && (
            <span className="floating-messages-badge">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="floating-messages-panel">
          <div className="floating-messages-header">
            <div>
              <div className="floating-messages-title">Messages</div>
              <div className="floating-messages-sub">Chat with admin and captains</div>
            </div>
            <button className="floating-messages-close" onClick={() => setOpen(false)}>Close</button>
          </div>

          {err && <div className="floating-messages-alert">{err}</div>}
          {loading && <div className="floating-messages-alert">Loading...</div>}

          <div className="floating-messages-threads">
            {threadButtons.map((t) => (
              <button
                key={t.user_id}
                className={t.user_id === selectedId ? "floating-thread active" : "floating-thread"}
                onClick={() => {
                  setSelectedId(t.user_id);
                  setComposeNew(false);
                  if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
                  setAttachment(null);
                  setAttachmentPreview(null);
                }}
              >
                <span>{t.name}</span>
                {t.unread_count ? <em>{t.unread_count}</em> : null}
              </button>
            ))}
            <button
              className={selectedId == null ? "floating-thread active" : "floating-thread"}
              onClick={() => {
                setSelectedId(null);
                setComposeNew(true);
                setRecipientId("");
                setMessages([]);
                if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
                setAttachment(null);
                setAttachmentPreview(null);
              }}
            >
              New
            </button>
          </div>

          {selectedId == null && (
            <select className="floating-select" value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
              <option value="">Select recipient</option>
              {recipients.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} ({r.role}){r.store ? ` - ${r.store}` : ""}
                </option>
              ))}
            </select>
          )}

          <div className="floating-messages-list">
            {messages.length === 0 ? (
              <div className="floating-empty">No messages yet.</div>
            ) : (
              messages.map((m) => {
                const mine = String(m.sender_id) === String(user?.id);
                const imageUrl = resolveMediaUrl(m.image_url);
                return (
                  <div key={m.id} className={mine ? "floating-bubble-row mine" : "floating-bubble-row"}>
                    <div className={mine ? "floating-bubble mine" : "floating-bubble"}>
                      {imageUrl && <img src={imageUrl} alt="Attachment" className="floating-bubble-image" />}
                      {m.body && <div>{m.body}</div>}
                      <div className="floating-bubble-meta">{formatTime(m.created_at)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="floating-composer">
            <div className="floating-attachment">
              <label className="floating-attach-label">
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
                  className="floating-attach-remove"
                  onClick={() => {
                    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
                    setAttachment(null);
                    setAttachmentPreview(null);
                  }}
                >
                  Remove
                </button>
              )}
              {attachmentPreview && <img src={attachmentPreview} alt="Preview" className="floating-attachment-preview" />}
            </div>
            <textarea
              rows={2}
              className="floating-textarea"
              placeholder="Type a message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!sending) sendMessage();
                }
              }}
            />
            <div className="floating-actions">
              <span className="floating-user">{user?.name || "User"}</span>
              <button className="floating-send" onClick={sendMessage} disabled={sending}>
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
