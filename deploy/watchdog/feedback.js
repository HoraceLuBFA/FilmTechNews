// Feedback stays behind the same private log login. Render submitted text without HTML interpretation.
const feedbackLabels = { new: "未查看", triaged: "已查看 · 待处理", replied: "已回复", resolved: "已解决", spam: "垃圾信息" };
let feedbackPage = 1, feedbackQuery = "", feedbackFilter = "", feedbackSignature = "", feedbackLoading = false, feedbackReload = false;

function feedbackLink(value, label) {
  try {
    const url = new URL(value, location.origin);
    if (!["https:", "http:"].includes(url.protocol)) return text("span", value, "muted");
    const a = text("a", label ?? value); a.href = url.href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a;
  } catch (_) { return text("span", value, "muted"); }
}

async function markFeedbackViewed(feedback, button) {
  button.disabled = true;
  try {
    const response = await fetch(`./api/feedback/${feedback.id}/viewed`, {
      method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: feedback.updated_at }),
    });
    if (!response.ok) throw Error(response.status === 409 ? "反馈已被修改，请刷新后再操作。" : "标记失败，请检查登录状态后重试。");
    await loadFeedback();
  } catch (error) { $('feedback-message').textContent = error.message; $('feedback-message').className = 'warn'; }
  finally { button.disabled = false; }
}

async function loadFeedback() {
  if (feedbackLoading) { feedbackReload = true; return; }
  feedbackLoading = true;
  try {
    const query = new URLSearchParams({ page: String(feedbackPage) });
    if (feedbackQuery) query.set('q', feedbackQuery);
    if (feedbackFilter) query.set('status', feedbackFilter);
    const response = await fetch('./api/feedback?' + query, { cache: 'no-store' });
    if (!response.ok) throw Error();
    const data = await response.json();
    const total = Object.values(data.counts).reduce((sum, value) => sum + value, 0);
    $('feedback-count').textContent = `共 ${total} 条 · ${data.counts.new ?? 0} 条未查看`;
    $('feedback-message').className = 'muted';
    $('feedback-message').textContent = data.rows.length ? '最近读取：' + at(new Date().toISOString()) : '没有符合条件的反馈。';
    $('feedback-page').textContent = '第 ' + data.page + ' 页';
    $('feedback-prev').disabled = data.page <= 1;
    $('feedback-next').disabled = !data.hasMore;
    const signature = JSON.stringify(data);
    if (signature !== feedbackSignature) {
      const fragment = document.createDocumentFragment();
      for (const feedback of data.rows) {
        const card = text('article', '', 'feedback-card'); card.dataset.feedbackId = feedback.id;
        const head = text('div', '', 'feedback-meta');
        head.append(text('span', '#' + feedback.id), text('span', feedbackLabels[feedback.status] ?? feedback.status, feedback.status === 'new' ? 'ok' : 'muted'), text('time', at(feedback.created_at), 'muted'));
        card.append(head, text('p', feedback.content, 'feedback-content'));
        if (feedback.email) card.append(text('p', '联系方式：' + feedback.email, 'muted'));
        if (feedback.page_url) { const p = text('p', '相关页面：'); p.append(feedbackLink(feedback.page_url)); card.append(p); }
        if (feedback.note) card.append(text('p', '处理备注：' + feedback.note, 'feedback-content muted'));
        if (feedback.screenshot === 'local') {
          const path = `./api/feedback/${feedback.id}/screenshot`;
          const a = feedbackLink(new URL(path, location.href).href, '');
          const image = document.createElement('img'); image.src = path; image.alt = '用户提交的反馈截图'; image.loading = 'lazy'; image.className = 'feedback-image'; a.append(image); card.append(a);
        } else if (feedback.screenshot === 'feishu') card.append(text('p', '截图已转存至原内部反馈渠道。', 'muted'));
        else if (feedback.screenshot === 'gone') card.append(text('p', '原截图已不可用。', 'muted'));
        if (feedback.status === 'new') {
          const button = text('button', '标为已查看'); button.type = 'button';
          button.addEventListener('click', () => markFeedbackViewed(feedback, button)); card.append(button);
        }
        fragment.append(card);
      }
      $('feedback-list').replaceChildren(fragment); feedbackSignature = signature;
    }
  } catch (_) {
    $('feedback-message').textContent = '反馈读取失败，请刷新或检查登录状态；已加载的内容仍保留。'; $('feedback-message').className = 'warn';
  } finally {
    feedbackLoading = false;
    if (feedbackReload) { feedbackReload = false; void loadFeedback(); }
  }
}

$('feedback-search').addEventListener('submit', (event) => {
  event.preventDefault(); feedbackQuery = $('feedback-query').value.trim(); feedbackFilter = $('feedback-filter').value; feedbackPage = 1; void loadFeedback();
});
$('feedback-refresh').addEventListener('click', () => void loadFeedback());
$('feedback-filter').addEventListener('change', () => $('feedback-search').requestSubmit());
$('feedback-prev').addEventListener('click', () => { feedbackPage = Math.max(1, feedbackPage - 1); void loadFeedback(); });
$('feedback-next').addEventListener('click', () => { feedbackPage += 1; void loadFeedback(); });
void loadFeedback(); setInterval(loadFeedback, 60000);
