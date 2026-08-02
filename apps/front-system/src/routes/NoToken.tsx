/** QR コードを読まずにアクセスされた場合の案内 */
export default function NoToken() {
  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-8 text-center">
      <p className="text-5xl">📱</p>
      <h1 className="mt-6 text-xl font-bold">BRIDGE</h1>
      <p className="mt-4 leading-relaxed text-stone-600">
        テーブルに置かれている QR コードを
        <br />
        スマートフォンで読み取ってください。
      </p>
      <p className="mt-6 text-sm text-stone-400">
        読み取れない場合は店員にお声がけください
      </p>
    </div>
  );
}
