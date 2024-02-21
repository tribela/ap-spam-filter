const PUBLIC_SCOPE = 'https://www.w3.org/ns/activitystreams#Public';
const content_regex = /(荒.*共.*栄.*圏)|(https:\/\/mastodon-japan\.net\/@ap12)|(https:\/\/荒らし.com\/)|(https:\/\/ctkpaarr.org)/gm;

const BAD_IMAGES = [
  '200x200 UkK2FEk8Oas:t1f9V[ae|;agoJofs;bYowjZ',
  '1009x200 UTQcblVY%gIU8w8_%Mxu%2Rjayt7.8?bMxRj',
];

const DATE = Date.parse('2024-02-18Z');

function isMentionsOnly(content) {
  const text = content.replace(/<[^>]*>/g, '');
  return /^(\s?(@[a-zA-Z0-9._-]+)+)*$/.test(text);
}

function username(object) {
  const url = object?.attributedTo;
  if (!url) {
    return null;
  }

  const match = url.match(/[^/]*$/);
  if (!match) {
    return null;
  }

  return match[0];
}

async function getAccountCreationTime(env, address) {
  const key = `WEBFINGER:${address}`
  let timestamp = Number(await env.KV.get(key));
  if (timestamp) {
    return timestamp;
  }

  const res = await fetch(address, {
    headers: {
      'Accept': 'application/activity+json',
    }
  });
  const json = await res.json();
  const published = json?.published;
  if (!published) {
    timestamp = null;
  } else {
    timestamp = Date.parse(published);
  }
  await env.KV.put(key, timestamp);
  return timestamp;
}

async function isSpam(env, json) {
  const type = json.type;
  const object = json.object ?? {};
  const to = (object?.to ?? [])[0];
  const ccLen = json.cc?.length ?? 0;
  const content = object?.content ?? '';
  const contentMap = object?.contentMap ?? {};
  const attachment = object?.attachment;

  const isJaLang = Object.keys(contentMap).includes('ja');
  const isNullLang = Object.keys(contentMap).length === 0;

  if (type !== 'Create') {
    return false;
  }

  if (to !== PUBLIC_SCOPE) {
    return false;
  }

  if (ccLen === 0) {
    return false;
  }

  if (!isJaLang && !isNullLang) {
    return false;
  }


  if (username(object)?.length !== 10) {
    return false;
  }

  const accountCreationTime = await getAccountCreationTime(env, object?.attributedTo);
  if (accountCreationTime > DATE) {
    return true;
  }

  if (ccLen > 6 && content_regex.test(content)) {
    return true;
  }

  if (/* isMentionsOnly(content) && */ attachment?.length === 1 && attachment[0].mediaType === 'image/webp') {
    const width = attachment[0].width ?? null;
    const height = attachment[0].height ?? null;
    const blurhash = attachment[0].blurhash ?? null;
    const fingerprint = `${width}x${height} ${blurhash}`;
    if (BAD_IMAGES.includes(fingerprint)) {
      return true
    }
  }

  return false;
}

export default {
  async fetch(request, env, ctx) {

    if (request.method !== 'POST') {
      return await fetch(request.url, {
        method: request.method,
        headers: request.headers,
      });
    }

    const bodyText = await request.text();

    try {
      const bodyJson = JSON.parse(bodyText);

      if (await isSpam(env, bodyJson)) {

        console.log('Got!!')
        try {
          if (env.NTFY_CHANNEL_URL) {
            const headers = {};
            if (env.NTFY_TOKEN) {
              headers['Authorization'] = `Bearer ${env.NTFY_TOKEN}`;
            }

            const message = bodyJson.object?.url ?? bodyJson.object?.atomUri ?? bodyText;

            await fetch(env.NTFY_CHANNEL_URL, {
              method: 'POST',
              body: `Zap! ${message}`,
              headers,
            });
          }
        } catch (e) {
          console.log('Failed to send notification');
        }

        return new Response('{}', {
          status: 400,
        })
      }
    } catch (e) {
      console.log(`Unknown error: ${e}`);
    }

    return fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: bodyText,
    })
  },
};
