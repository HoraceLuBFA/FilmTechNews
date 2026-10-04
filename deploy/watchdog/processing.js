// Private, model-free diagnostics. Render stored titles/reasons as text, never as markup.
const processingResumed = new Map();

async function resumeProcessing(item, button) {
  button.disabled = true;
  try {
    const response = await fetch(`./api/processing/${encodeURIComponent(item.id)}/resume`, {
      method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: item.revision, pausedAt: item.paused_at }),
    });
    if (!response.ok) throw Error(response.status === 409 ? "文章状态已变化，请等待新采样或刷新。" : "恢复失败，请检查登录状态后重试。");
    processingResumed.set(item.id, item.paused_at);
    button.textContent = "已恢复，等待采样";
    $('processing-message').textContent = "文章已重新入队，复用已有成功请求结果；下次云端采样会更新状态。";
    $('processing-message').className = 'ok';
  } catch (error) {
    $('processing-message').textContent = error.message;
    $('processing-message').className = 'warn';
    button.disabled = false;
  }
}

function renderProcessing(sample) {
  const items = sample.processing_items || [], queue = sample.queue || {};
  $('processing-count').textContent = `暂缓 ${queue.paused || 0} 篇`;
  $('processing-list').replaceChildren();
  if (!Array.isArray(sample.processing_items)) {
    $('processing-list').append(text('p', '等待新版云端采样，尚未取得单篇处理状态。', 'muted'));
    return;
  }
  if (!items.length) {
    $('processing-list').append(text('p', '当前没有待处理、失败或暂缓的文章。', 'muted'));
    return;
  }
  const labels = { new: '处理中 / 排队', failed: '处理失败', paused: '已暂缓' };
  const stages = { analyze: '模型分析', extract: '正文提取' };
  for (const item of items) {
    const card = text('article', '', 'feedback-card'), head = text('div', '', 'feedback-meta');
    card.dataset.processingId = item.id;
    const link = text('a', item.title); link.href = '/items/' + encodeURIComponent(item.id);
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    head.append(text('span', labels[item.state] || '待检查', item.state === 'new' ? 'muted' : 'warn'), text('span', item.source, 'muted'));
    card.append(head, link, text('p', `版本 ${item.revision} · ${stages[item.stage] || '等待阶段领取'} · 累计交接 ${item.handoffs} 次 · 连续无进展 ${item.stalled_handoffs} 次 · 失败 ${item.failures} 次`, 'muted'));
    card.append(text('p', '最近推进：' + at(item.progress_at) + (item.retry_at ? ' · 重试：' + at(item.retry_at) : ''), 'muted'));
    if (item.reason) card.append(text('p', item.reason, 'warn'));
    card.append(text('p', item.next_action, 'muted'));
    if (item.state === 'paused') {
      const button = text('button', '核查后恢复处理'); button.type = 'button';
      if (processingResumed.get(item.id) === item.paused_at) { button.disabled = true; button.textContent = '已恢复，等待采样'; }
      button.addEventListener('click', () => resumeProcessing(item, button)); card.append(button);
    }
    $('processing-list').append(card);
  }
}
