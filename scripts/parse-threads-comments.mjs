import { readFileSync } from 'fs';

const HAR_FILE = process.argv[2] || 'threads-comments.har';

let harText;
try {
  harText = readFileSync(HAR_FILE, 'utf8');
} catch {
  console.error(`Error: Could not read ${HAR_FILE}`);
  console.error('Usage: node scripts/parse-threads-comments.mjs [path-to-har]');
  process.exit(1);
}

const har = JSON.parse(harText);
const comments = [];

for (const entry of har.log.entries) {
  const url = entry.request.url;

  // Threads GraphQL or Instagram API endpoints that carry comment data
  if (!url.includes('graphql') && !url.includes('api/v1')) continue;

  const responseText = entry.response.content?.text || '';
  if (!responseText) continue;

  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    continue;
  }

  // Walk the response recursively looking for comment arrays
  extractComments(json, comments);
}

function extractComments(obj, out) {
  if (!obj || typeof obj !== 'object') return;

  // Threads GraphQL response shape: thread_items[]
  if (Array.isArray(obj.thread_items)) {
    for (const item of obj.thread_items) {
      const post = item.post || item;
      pushComment(post, out);
    }
    return;
  }

  // Instagram-style: edge_media_to_comment.edges[].node
  if (obj.edge_media_to_comment?.edges) {
    for (const edge of obj.edge_media_to_comment.edges) {
      pushComment(edge.node, out);
    }
    return;
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) extractComments(item, out);
  } else {
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') extractComments(val, out);
    }
  }
}

function pushComment(node, out) {
  if (!node) return;
  const username =
    node.user?.username ||
    node.owner?.username ||
    node.author?.username ||
    '';
  const text =
    node.caption?.text ||
    node.text ||
    node.content ||
    '';
  const ts = node.taken_at || node.timestamp || node.created_at || 0;
  const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
  const likes = node.like_count ?? node.likes_count ?? node.likeCount ?? 0;
  const replies =
    node.reply_count ??
    node.text_post_app_replies_count ??
    node.edge_media_to_comment?.count ??
    0;

  if (!text || !username) return;

  out.push({ username, text, date, likes, replies });
}

// Deduplicate by username+text
const seen = new Set();
const unique = comments.filter(c => {
  const key = `${c.username}|${c.text}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

if (unique.length === 0) {
  console.error('No comments found. The HAR may not contain the right requests.');
  console.error('Tip: scroll through all comments before saving the HAR.');
  process.exit(1);
}

console.error(`Parsed ${unique.length} unique comments.`);
console.log(JSON.stringify(unique, null, 2));
