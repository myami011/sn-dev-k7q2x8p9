/* data.js — 데이터 읽기 (라즈베리파이가 올린 JSON 파일)
 *  data/meta.json · data/notices.json · data/detail/<id>.json
 *  'no-cache': 매번 서버에 최신인지 확인하고, 같으면 받아 둔 것을 재사용(304).
 *  인터넷이 끊기면 service worker 가 마지막으로 받은 파일을 돌려준다.
 */
const Data = (() => {
  async function getJson(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('데이터를 불러오지 못했습니다 (' + res.status + ')');
    return res.json();
  }
  return {
    meta:    () => getJson('data/meta.json'),
    notices: () => getJson('data/notices.json'),
    detail:  (id) => getJson('data/detail/' + Number(id) + '.json'),
  };
})();
