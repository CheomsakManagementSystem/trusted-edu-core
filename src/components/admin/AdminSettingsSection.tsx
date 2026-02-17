const AdminSettingsSection = () => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-50">설정</h2>
        <p className="text-sm text-slate-400">
          추후 알림, 권한, 시스템 환경설정 등을 구성할 수 있는 영역입니다.
        </p>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-300">
        <p>
          현재는 기본 플레이스홀더 상태입니다. 필요 시 이메일 알림, 리포트
          템플릿, 데이터 백업 설정 등의 옵션을 이 섹션에 추가할 수 있습니다.
        </p>
      </div>
    </div>
  );
};

export default AdminSettingsSection;

