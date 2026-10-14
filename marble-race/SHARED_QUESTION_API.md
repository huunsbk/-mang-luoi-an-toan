# Ngân hàng học liệu số dùng chung — MotionClass / AI Pose Quiz / Marble Race

## Nguồn dữ liệu
Project Supabase: MotionClass (`exfnarddchxzfewlztwb`).
- **Giữ nguyên** `public.pose_quiz_question_bank` và Edge Function `pose-quiz-api`. Nội dung nguồn nằm trong `question: jsonb`, bốn phương án trong `question.answers[]`, phương án đúng bằng `isCorrect === true`.
- Kho âm thanh mới: `public.shared_question_audio` + **private** Storage bucket `shared-question-voices`.
- Mọi trò chơi dùng chung Edge Function **`shared-question-api`**, triển khai độc lập với `pose-quiz-api`; project Giaipic nằm ngoài phạm vi.

## Tích hợp cho trò chơi mới
Tạo Supabase Client (v2) bằng project URL và **publishable key** (không dùng secret key ở trình duyệt). Đăng nhập `auth.signInWithPassword` hoặc sử dụng phiên của Pose Quiz khi chung origin.
Gọi:

```js
async function sharedBankRequest(client, action, payload = {}) {
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token) throw new Error("Cần đăng nhập");
  const response = await fetch(
    "https://exfnarddchxzfewlztwb.supabase.co/functions/v1/shared-question-api",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + session.access_token,
        apikey: "<project publishable key>",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, ...payload })
    }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}
const result = await sharedBankRequest(client, "bank.list", {
  subject: "ALL", lesson: "ALL", search: ""
});
```

`bank.list` returns `items[]`: `id, subject, lesson, text, options[4], correct, imageUrl, spoken.{full, question, option_a, option_b, option_c, option_d, answer}, owned, visibility`.
The API ensures access by owner/public/group, and signs image URLs after authorization. Do not assume anonymous access; school and private questions require user login.

`audio.list` accepts `ids: UUID[]`, `voice_id: "nghi:deepman3909"`; returns `items[]` with `id, part, textHash, url` (temporary signed URL).
Audio parts supported: `full, question, option_a, option_b, option_c, option_d, answer`. Verify `textHash` (SHA-256 of canonical spoken text) before reusing an audio clip; if stale, regenerate it.

`audio.put` is a **multipart/form-data** request:
- `action=audio.put`
- `id=<question uuid>`
- `voice_id=nghi:<model id>`
- `part=full` (or another supported part)
- `audio=<File>` with WAV/RIFF content, size <= 5 MB.

Only a question's owner can upload new audio. Endpoints use the logged-in user's JWT; never expose a Supabase secret/service role in web source. Existing question answers cannot be modified by the audio API. Audio is synthesised locally using NGHI-TTS before upload, and downloaded from private Supabase Storage via signed links for reuse.

## ZIP
Marble Race exports `questions.json`, audio `audio/<id>/<voice>/<full|answer>.wav`, and any signed question images to `images/<id>.<extension>`. A new game can consume this standard and load audio without calling a TTS service.

## Test boundary
Tested frontend with mocked logged-in session and API responses in Chromium/WebKit; tested unauthenticated API denies access with HTTP 401; Vercel deployment staging READY. End-to-end test with a real teacher's account is still required for signed URLs, owner uploads and actual private Storage permissions.
