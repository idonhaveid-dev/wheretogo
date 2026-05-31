import siteData from "../public/data/regions.json" assert { type: "json" };

const categoryLabels = {
  food: "맛집",
  domestic_travel: "국내여행"
};

const matchLabels = {
  exact_place: "장소 확인",
  event_on_place: "이벤트",
  alias_match: "별칭 매칭",
  weak_match: "검토 필요"
};

function formatScore(value) {
  const number = Number(value || 0);
  return number.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

export default function Home() {
  const regions = siteData.regions || [];
  const featured = regions[0];

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Naver Blog Trend MVP</p>
          <h1>지역별로 보는 오늘의 핫플</h1>
          <p className="summary">
            네이버 블로그 최신글에서 언급량이 늘어난 지역을 먼저 보고, 각 지역 안에서 실제 장소로 검증된 후보를 확인합니다.
          </p>
        </div>
        <div className="stats" aria-label="데이터 요약">
          <span>
            <strong>{siteData.generated_at_label}</strong>
            기준일
          </span>
          <span>
            <strong>{regions.length}</strong>
            지역
          </span>
          <span>
            <strong>{siteData.total_places}</strong>
            후보
          </span>
        </div>
      </header>

      <section className="layout">
        <aside className="regions" aria-label="오늘 뜨는 지역">
          <div className="section-title">
            <h2>오늘 뜨는 지역</h2>
            <p>hot score 합산 기준</p>
          </div>
          <div className="region-list">
            {regions.map((region) => (
              <a className="region-row" href={`#region-${region.slug}`} key={region.region}>
                <span className="rank">{region.rank}</span>
                <span>
                  <strong>{region.region}</strong>
                  <em>{region.place_count}개 후보</em>
                </span>
                <b>{formatScore(region.hot_score)}</b>
              </a>
            ))}
          </div>
        </aside>

        <section className="content">
          {featured ? (
            <section className="spotlight" id={`region-${featured.slug}`}>
              <div>
                <p className="eyebrow">Top Region</p>
                <h2>{featured.region}</h2>
                <p>{featured.top_places.slice(0, 3).join(" · ")}</p>
              </div>
              <strong>{formatScore(featured.hot_score)}</strong>
            </section>
          ) : null}

          {regions.map((region) => (
            <section className="region-section" id={`region-${region.slug}`} key={region.region}>
              <div className="section-title">
                <h2>{region.region}</h2>
                <p>{region.place_count}개 장소/이벤트</p>
              </div>

              <div className="place-grid">
                {region.places.map((place) => (
                  <article className="place-card" key={`${region.region}-${place.rank}-${place.display_name}`}>
                    <div className="card-head">
                      <span>{categoryLabels[place.category] || place.category}</span>
                      <span>{matchLabels[place.match_type] || place.match_type}</span>
                    </div>
                    <h3>{place.display_name}</h3>
                    {place.official_place_name && place.official_place_name !== place.display_name ? (
                      <p className="official">공식 장소: {place.official_place_name}</p>
                    ) : null}
                    <dl>
                      <div>
                        <dt>점수</dt>
                        <dd>{formatScore(place.hot_score)}</dd>
                      </div>
                      <div>
                        <dt>언급</dt>
                        <dd>{place.blog_post_count}</dd>
                      </div>
                      <div>
                        <dt>검증</dt>
                        <dd>{place.match_score}</dd>
                      </div>
                    </dl>
                    <p className="address">{place.roadAddress || place.address || "주소 확인 필요"}</p>
                    {place.sample_links?.[0] ? (
                      <a className="sample-link" href={place.sample_links[0]} target="_blank" rel="noreferrer">
                        블로그 샘플 보기
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>
      </section>
    </main>
  );
}
