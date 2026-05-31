import "./globals.css";

export const metadata = {
  title: "wheretogo",
  description: "지역별로 보는 오늘의 핫플 데이터 MVP"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
