import DashboardLayout from "@/components/DashboardLayout";

const guideSteps = [
  "반을 선택한 뒤 시험 날짜를 고릅니다.",
  "날짜가 선택되면 바로 PDF 파일을 등록합니다.",
  "파싱된 내용을 확인한 뒤 학생에게 전송합니다.",
];

const Guide = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6 px-4 py-6 md:px-0">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-xl">
            이용 가이드
          </h2>
          <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            날짜만 선택하면 리포트가 전송됩니다.
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 md:text-base">업로드 흐름</h3>
          <div className="mt-4 space-y-3">
            {guideSteps.map((step, index) => (
              <div
                key={step}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <p className="text-sm text-slate-700">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
};

export default Guide;
