// Turns raw tiktok-live-connector payloads (or mock payloads shaped the same
// way) into small, stable game events. The game only ever sees these shapes:
//
//   { type: 'chat',   user, text }
//   { type: 'gift',   user, gift: { id, name, coins, streakable }, delta, total, end }
//   { type: 'like',   user, count }
//   { type: 'share',  user }        { type: 'follow', user }
//   { type: 'member', user }        { type: 'viewers', count }
//   { type: 'streamEnd' }
//
// user = { id, uid, name, avatar, isMod, isSub, isFollower, isAnchor }
//
// Gift streaks: TikTok re-sends a streakable gift (giftType 1) with a growing
// repeatCount, then sends one more event with repeatEnd = true. We emit only
// the *new* gifts in each event as `delta`, so effects fire instantly while
// the viewer is still tapping, and nothing is counted twice.

export function normUser(u, ident) {
  if (!u) return { id: 'anon', uid: 'anon', name: 'viewer', avatar: '' };
  const uid = u.uniqueId || u.displayId || u.username || '';
  const id = String(u.userId || u.id || uid || 'anon');
  const avatar =
    u.profilePictureUrl ||
    (u.profilePicture && u.profilePicture.url && u.profilePicture.url[0]) ||
    (u.avatarThumb && u.avatarThumb.urlList && u.avatarThumb.urlList[0]) ||
    (u.avatarMedium && u.avatarMedium.urlList && u.avatarMedium.urlList[0]) ||
    '';
  const idt = ident || u.userIdentity || {};
  return {
    id,
    uid,
    name: String(u.nickname || uid || 'viewer').slice(0, 24),
    avatar,
    isMod: !!(idt.isModeratorOfAnchor || u.isModerator),
    isSub: !!(idt.isSubscriberOfAnchor || u.isSubscriber),
    isFollower: !!(idt.isFollowerOfAnchor || (u.followInfo && Number(u.followInfo.followStatus) > 0)),
    isAnchor: !!idt.isAnchor,
  };
}

export function createNormalizer() {
  const streaks = new Map(); // key -> { count, t }
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < 10000) return;
    lastSweep = now;
    for (const [k, v] of streaks) if (now - v.t > 60000) streaks.delete(k);
  }

  function gift(raw) {
    const user = normUser(raw.user, raw.userIdentity);
    const g = raw.gift || raw.giftDetails || {};
    const ext = raw.extendedGiftInfo || {};
    const id = String(raw.giftId != null ? raw.giftId : g.id != null ? g.id : '0');
    const name = String(g.name || g.giftName || ext.name || 'Gift ' + id);
    const coins = Number(g.diamondCount != null ? g.diamondCount : ext.diamond_count != null ? ext.diamond_count : ext.diamondCount) || 1;
    const giftType = Number(g.type != null ? g.type : g.giftType != null ? g.giftType : ext.type);
    const streakable = giftType === 1;
    const repeat = Math.max(1, Number(raw.repeatCount) || 1);
    const end = Boolean(Number(raw.repeatEnd));
    const now = Date.now();
    sweep(now);

    if (!streakable) {
      return { type: 'gift', user, gift: { id, name, coins, streakable }, delta: repeat, total: repeat, end: true };
    }
    const key = user.id + ':' + id + ':' + (raw.groupId || '');
    const prev = streaks.get(key);
    const seen = prev ? prev.count : 0;
    const delta = Math.max(0, repeat - seen);
    if (end) streaks.delete(key);
    else streaks.set(key, { count: Math.max(seen, repeat), t: now });
    if (delta === 0 && !end) return null;
    return { type: 'gift', user, gift: { id, name, coins, streakable }, delta, total: Math.max(seen, repeat), end };
  }

  function normalize(kind, raw) {
    if (!raw && kind !== 'streamEnd') return null;
    switch (kind) {
      case 'chat': {
        const text = String(raw.comment != null ? raw.comment : raw.content || '').slice(0, 200);
        return { type: 'chat', user: normUser(raw.user, raw.userIdentity), text };
      }
      case 'gift':
        return gift(raw);
      case 'like': {
        const count = Number(raw.likeCount != null ? raw.likeCount : raw.count) || 1;
        return { type: 'like', user: normUser(raw.user, raw.userIdentity), count };
      }
      case 'share':
        return { type: 'share', user: normUser(raw.user, raw.userIdentity) };
      case 'follow':
        return { type: 'follow', user: normUser(raw.user, raw.userIdentity) };
      case 'member':
        return { type: 'member', user: normUser(raw.user, raw.userIdentity) };
      case 'roomUser': {
        const count = Number(raw.viewerCount != null ? raw.viewerCount : raw.total) || 0;
        return { type: 'viewers', count };
      }
      case 'streamEnd':
        return { type: 'streamEnd' };
      default:
        return null;
    }
  }

  return { normalize };
}
