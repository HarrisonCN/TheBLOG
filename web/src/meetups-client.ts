/**
 * L56 / v1.56.0 活动与聚会（按需加载）：活动页显示报名单选（参加 / 可能参加 / 不参加），「参加」在本机占一个名额，满员时不能选「参加」；
 * 列表页和活动页按打开时的当前时间标出「已结束」（只算一次，没有计时器）。报名只存在 localStorage，没有网络请求。
 */
import { readMap, writeMap } from './ck-store';
import { isPast, RSVP_KEY, seatsLeft, seatsText } from './meetups-core';

const LABEL: Record<string, string> = { going: '已报名参加', maybe: '已标记为可能参加', no: '已标记为不参加' };

export function bind(root: ParentNode, now: Date = new Date()): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-meetups]')) {
    for (const s of box.querySelectorAll<HTMLElement>('[data-mu-end]')) {
      if (isPast(s.dataset.muEnd!, now) && !s.parentElement!.querySelector('.mu-past')) s.insertAdjacentHTML('afterend', ' <span class="mu-past small">已结束</span>');
    }
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-meetup]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.meetup!;
    const cap = Number(box.dataset.capacity) || 0;
    const going = Number(box.dataset.going) || 0;
    const fs = box.querySelector<HTMLElement>('[data-mu-rsvp]');
    const left = box.querySelector<HTMLElement>('[data-mu-left]');
    const st = box.querySelector<HTMLElement>('[data-mu-status]');
    const past = box.querySelector<HTMLElement>('[data-mu-past]');
    if (!fs || !left || !st || !past) continue;
    const ended = isPast(box.dataset.end!, now);
    past.hidden = !ended;
    if (ended) continue;
    const radios = [...fs.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    const mine = () => {
      const v = readMap(RSVP_KEY)[slug];
      return typeof v === 'string' && v in LABEL ? v : '';
    };
    const paint = () => {
      const m = mine();
      for (const r of radios) r.checked = r.value === m;
      const l = seatsLeft(cap, going, m === 'going');
      left.textContent = seatsText(l);
      radios.find((r) => r.value === 'going')!.disabled = l === 0 && m !== 'going';
    };
    fs.addEventListener('change', () => {
      const v = radios.find((r) => r.checked)?.value ?? '';
      const map = readMap(RSVP_KEY);
      if (v) map[slug] = v;
      else delete map[slug];
      writeMap(RSVP_KEY, map);
      st.textContent = v ? `${LABEL[v]}（只记在这台设备上）。` : '';
      paint();
    });
    fs.hidden = false;
    paint();
  }
}
