export async function connection() {}

/* proxy.ts 시험용 최소 NextResponse (next·redirect·json 만, 헤더 확인용) */
export class NextResponse extends Response {
  static next() {
    return new NextResponse(null, { status: 200, headers: { "x-middleware-next": "1" } });
  }
  static redirect(url) {
    return new NextResponse(null, { status: 307, headers: { location: String(url) } });
  }
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
}
