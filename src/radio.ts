export async function radioVideo(input: unknown) {
  if (typeof input !== "string" || input.length > 600)
    throw Error("请输入 YouTube 链接");
  const raw = input.trim();
  const url = new URL(
    raw.startsWith("@") ? "https://www.youtube.com/" + raw : raw,
  );
  if (
    url.protocol !== "https:" ||
    !["youtu.be", "www.youtube.com", "youtube.com", "m.youtube.com"].includes(
      url.hostname,
    )
  )
    throw Error("请输入 YouTube 频道或视频链接");
  const path = url.pathname;
  let id =
    url.hostname === "youtu.be"
      ? path.slice(1)
      : path === "/watch"
        ? url.searchParams.get("v")
        : path.match(/^\/live\/([\w-]+)$/)?.[1];
  if (
    !id &&
    /^\/(?:@[\p{L}\p{N}._%-]+|channel\/UC[\w-]{22})(?:\/live)?\/?$/u.test(path)
  ) {
    const res = await fetch(
      "https://www.youtube.com" + path.replace(/(?:\/live)?\/?$/, "/live"),
      { signal: AbortSignal.timeout(8000) },
    );
    const html = await res.text();
    id = html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
    )?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id))
    throw Error("没有找到直播，可贴一个视频链接");
  const meta = await fetch(
    "https://www.youtube.com/oembed?format=json&url=" +
      encodeURIComponent("https://www.youtube.com/watch?v=" + id),
    { signal: AbortSignal.timeout(8000) },
  );
  if (!meta.ok) throw Error("YouTube 未提供这个视频的播放器");
  const { title } = (await meta.json()) as { title: string };
  return { id, title };
}
