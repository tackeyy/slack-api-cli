/** Slack channel information. */
export interface Channel {
  id: string;
  name: string;
  topic: string;
  purpose: string;
  num_members: number;
  is_private: boolean;
  is_archived: boolean;
}

/** Slack channel with unread information. */
export interface UnreadChannel extends Channel {
  unread_count: number;
}

/** Slack file info. */
export interface SlackFileInfo {
  id: string;
  name: string;
  mimetype: string;
  filetype: string;
  size: number;
  url_private_download: string;
}

/** A reaction attached to a Slack message. */
export interface MessageReaction {
  name: string;
  count: number;
  users: string[];
}

/**
 * Slack message.
 *
 * 基本フィールド (ts/user/text/thread_ts/reply_count/files) に加え、
 * interactive content (blocks/attachments/reactions) と bot/メタデータ (bot_id/subtype/team)
 * を Slack API が返した場合はそのまま透過する。
 * これらは bot 投稿の Block Kit UI 確認や reaction 可視化に必須。
 */
export interface Message {
  ts: string;
  user: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  files?: SlackFileInfo[];
  bot_id?: string;
  subtype?: string;
  team?: string;
  /** Slack Connect で発言者が属する workspace（Slack の応答にあるときだけ）。 */
  user_team?: string;
  /** Slack Connect で発言が投稿された元の workspace（Slack の応答にあるときだけ）。 */
  source_team?: string;
  /** アプリ経由の投稿のときのアプリの ID（Slack の応答にあるときだけ）。 */
  app_id?: string;
  blocks?: Record<string, unknown>[];
  attachments?: Record<string, unknown>[];
  reactions?: MessageReaction[];
}

/** Slack user. */
export interface User {
  id: string;
  name: string;
  real_name: string;
  display_name: string;
  email?: string;
  is_bot: boolean;
  deleted: boolean;
}

/** Detailed user profile. */
export interface UserProfile {
  id: string;
  name: string;
  real_name: string;
  display_name: string;
  email: string;
  title: string;
  phone: string;
  status_text: string;
  status_emoji: string;
  tz: string;
  is_admin: boolean;
  is_bot: boolean;
  deleted: boolean;
  /** 所属の組織（Slack Connect の相手先なら相手の workspace の ID）。無ければ空文字 */
  team_id: string;
  /** 複数チャンネルのゲスト */
  is_restricted: boolean;
  /** 1チャンネルのゲスト */
  is_ultra_restricted: boolean;
}

/** Search result. */
export interface SearchResult {
  matches: SearchMatch[];
  total: number;
  page: number;
}

/** Individual search match. */
export interface SearchMatch {
  ts: string;
  channel: string;
  channel_id: string;
  user: string;
  text: string;
  permalink: string;
}

/** Auth test result. */
export interface AuthInfo {
  user_id: string;
  user: string;
  team_id: string;
  team: string;
  url: string;
}

/** Workspace (team) info returned by team.info. */
export interface TeamInfo {
  id: string;
  name: string;
  /** Slack subdomain, e.g. "example-workspace". */
  domain: string;
  /**
   * Email domain restriction for the workspace, e.g. "example.com".
   * Empty when no domain is configured. Useful for diagnosing SSO domain mismatches.
   */
  email_domain: string;
  /** Enterprise Grid org id (empty for standalone workspaces). */
  enterprise_id: string;
  /** Enterprise Grid org name (empty for standalone workspaces). */
  enterprise_name: string;
  /** Workspace icon URL (132px), empty when unset. */
  icon: string;
}

/** A reaction item returned by reactions.list. */
export interface ReactionItem {
  name: string;
  channel: string;
  timestamp: string;
  message_text: string;
}

/** Result of reactions.list. */
export interface ReactionsListResult {
  items: ReactionItem[];
  total: number;
}

/** Slack reaction_added event payload. */
export interface ReactionAddedEvent {
  type: "reaction_added";
  user: string;
  reaction: string;
  item: { type: string; channel: string; ts: string };
  item_user: string;
  event_ts: string;
}

/** User engagement metrics for a date range. */
export interface EngagementMetrics {
  userId: string;
  since: string; // "YYYY-MM-DD"
  until: string; // "YYYY-MM-DD"
  postCount: number;
  reactionGivenCount: number; // 日付範囲内でリアクションしたメッセージ数 (同メッセージ複数絵文字は1カウント)
  fetchedAt: string; // ISO 8601
  /** 集計に使われた timezone (IANA。例: "Asia/Tokyo") */
  timezone: string;
  /** MAX_REACTION_PAGES で reactions.list が打ち切られた場合 true (過小カウントの可能性) */
  truncated: boolean;
}

/** Slack event payload. */
export interface SlackEvent {
  type: string;
  user: string;
  text: string;
  ts: string;
  channel: string;
  thread_ts?: string;
  channel_type?: string;
  subtype?: string;
  bot_id?: string;
}

/** Slack assistant_thread_started event payload. */
export interface AssistantThreadStartedEvent {
  type: "assistant_thread_started";
  assistant_thread: {
    user_id: string;
    channel_id: string;
    thread_ts: string;
    context?: {
      channel_id?: string;
      team_id?: string;
      enterprise_id?: string;
    };
  };
}

/** Slack assistant_thread_context_changed event payload. */
export interface AssistantThreadContextChangedEvent {
  type: "assistant_thread_context_changed";
  assistant_thread: {
    user_id: string;
    channel_id: string;
    thread_ts: string;
    context?: {
      channel_id?: string;
      team_id?: string;
      enterprise_id?: string;
    };
  };
}

/** Read-only sharing metadata. Omitted fields remain unknown, never false/empty defaults. */
export interface ChannelSharingInfo {
  id: string;
  name?: string;
  is_private?: boolean;
  is_shared?: boolean;
  is_ext_shared?: boolean;
  is_pending_ext_shared?: boolean;
  is_im?: boolean;
  is_org_shared?: boolean;
  shared_team_ids?: string[];
  connected_team_ids?: string[];
  context_team_id?: string;
  conversation_host_id?: string;
}
