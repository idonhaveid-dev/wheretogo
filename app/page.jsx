import siteData from "../public/data/regions.json" assert { type: "json" };
import RegionsExplorer from "./RegionsExplorer";

export default function Home() {
  const regions = siteData.regions || [];

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
            <strong>{siteData.generated_at_label || "데이터 없음"}</strong>
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

      <RegionsExplorer regions={regions} />
    </main>
  );
}
