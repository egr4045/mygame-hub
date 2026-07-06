import { z } from 'zod';

/**
 * Community contract (HTTP, served by `community`): per-game changelog + discussion forum. A
 * separate service from auth/social/chat — unbounded user-generated content with its own
 * moderation/growth profile, kept out of the security-critical identity process.
 *
 * Trust model: changelog reads are public, writes require an access token AND membership in the
 * service's admin allowlist (`COMMUNITY_ADMIN_IDS`) — patch notes are curated, not user content.
 * Discussion reads are public; creating a thread/post requires only a valid access token (the same
 * posture as chat/achievements — no per-game moderation yet, see docs/STATUS.md).
 */

export const changelogEntry = z.object({
  id: z.string(),
  gameId: z.string(),
  version: z.string(),
  title: z.string(),
  body: z.string(),
  publishedAt: z.number(), // epoch ms
});
export type ChangelogEntry = z.infer<typeof changelogEntry>;

export const createChangelogRequest = z.object({
  gameId: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
});
export type CreateChangelogRequest = z.infer<typeof createChangelogRequest>;

export const changelogListResponse = z.object({ entries: z.array(changelogEntry) });
export type ChangelogListResponse = z.infer<typeof changelogListResponse>;

// --- Discussions --------------------------------------------------------------------------------

export const discussionPost = z.object({
  id: z.string(),
  threadId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.number(), // epoch ms
});
export type DiscussionPost = z.infer<typeof discussionPost>;

export const discussionThread = z.object({
  id: z.string(),
  gameId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  title: z.string(),
  createdAt: z.number(), // epoch ms
  replyCount: z.number(),
  /** createdAt of the most recent post (== the thread's own createdAt if never replied to). */
  lastReplyAt: z.number(),
});
export type DiscussionThread = z.infer<typeof discussionThread>;

export const createThreadRequest = z.object({
  gameId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  /** Seeds the thread's first post. */
  body: z.string().min(1).max(20_000),
});
export type CreateThreadRequest = z.infer<typeof createThreadRequest>;

export const createPostRequest = z.object({
  threadId: z.string().min(1),
  body: z.string().min(1).max(20_000),
});
export type CreatePostRequest = z.infer<typeof createPostRequest>;

export const threadListResponse = z.object({ threads: z.array(discussionThread) });
export type ThreadListResponse = z.infer<typeof threadListResponse>;

export const threadDetailResponse = z.object({ thread: discussionThread, posts: z.array(discussionPost) });
export type ThreadDetailResponse = z.infer<typeof threadDetailResponse>;
