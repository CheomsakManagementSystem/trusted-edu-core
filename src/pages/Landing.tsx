import { Link } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Edit, Search, ShieldCheck, User, Users } from "lucide-react";

const commonRules = [
  "환경: 반드시 Google Chrome(크롬) 최신 버전 사용을 권장합니다.(컴퓨터 로그인 기준)",
  "실명 원칙: 학생과 강사 모두 학원에 등록된 실명으로 가입해야 합니다. (데이터 누락 방지)",
  "로그인 보안:",
  "최초 가입 시 권한별 초대 코드 입력이 필수입니다.",
  "실장님은 관리 화면 진입 시 마스터 보안 코드를 통과해야 합니다.",
  "비밀번호 분실 시 보안상 재설정 대신 [계정 삭제 후 재가입]을 원칙으로 합니다.(김겨울팀장님게 문의주시면 삭제해드립니다.)",
];

const managerGuide = [
  '👑 [실장님/관리자] 학원 전체 관리 및 보안 가이드',
  '"강의실 운영부터 유저 사고 수습까지 시스템의 모든 권한을 제어합니다."',
  "① 마스터 시스템 제어 (보안 및 알림)",
  "선생님용 가입 비밀코드: 신규 강사 가입 시 필요한 코드를 직접 설정합니다. 보안을 위해 주기적으로 변경을 권장합니다.",
  "첨삭 완료 알림 설정: [첨삭 완료 알림 끄고 켜기] 기능을 통해, 리포트 배포 시 학생에게 자동으로 알림 문자가 발송되도록 제어할 수 있습니다.",
  "② 유저 관리 및 사고 수습 (실시간 대응)",
  "통합 명단 관리: 가입된 모든 유저(학생/선생님/실장님)의 이름, 이메일, 고유ID를 확인합니다.",
  "계정 삭제: 잘못된 정보로 가입하거나 로그인이 불가능한 경우 해당 유저를 삭제합니다.",
  "주의: 삭제 시 해당 유저는 처음부터 다시 가입해야 하며, 기존 데이터는 복구되지 않습니다.",
  "학생 리포트 상세 조회: 특정 학생을 선택하여 실제 획득 점수와 강사가 입력한 총평을 한눈에 확인하고 상담 자료로 활용합니다.",
  "③ 강의실 개설 및 편집",
  "수업 목록 관리: 학원별(시대인재, 명인 등), 요일별, 시간별로 반을 개설하거나 명칭을 수정합니다.",
  "신규 학생 배정: 가입 신청한 학생을 해당 반에 배정합니다. 배정이 완료된 학생은 목록에서 자동 제외되어 관리가 간편합니다.",
  "④ 관리자 계정 탈퇴",
  "회원 탈퇴: 실장님 본인의 계정을 정리해야 할 때 사용합니다. 탈퇴 시 모든 시스템 제어 권한이 즉시 상실되므로 신중히 결정해야 합니다.",
];

const teacherGuide = [
  "✍️ [강사] 첨삭 리포트 등록 4단계 절차",
  '"입력이 완료된 리포트만 학생 대시보드로 안전하게 전달됩니다."',
  "[1단계: 반 선택]: 리포트를 등록할 해당 수업을 정확히 선택합니다.",
  "[2단계: 파일 등록]: 첨삭이 완료된 PDF 파일을 업로드합니다.",
  "[3단계: 내용 확인]: 중요! 업로드된 파일의 항목들이 표시되면, PDF 내용과 시스템의 입력값이 일치하는지 수동으로 최종 대조합니다. (오타 및 점수 오류 검수)",
  "[4단계: 학생에게 발송]: 모든 검수가 끝난 리포트만 학생에게 전송합니다. 발송 즉시 학생은 리포트를 열람할 수 있습니다.",
  "리포트 보관함: 이미 발송된 리포트의 내용을 수정하거나, 배포 실수 시 '리포트 회수/삭제' 기능을 통해 즉시 회수할 수 있습니다.",
];

const studentGuide = [
  "🎓 [학생] 나의 성장 리포트 활용 가이드",
  '"내 점수 변화와 선생님의 상세 피드백을 실시간으로 확인합니다."',
  "반 가입 신청: 본인이 수강하는 수업을 선택해 신청하고 실장님의 승인을 받습니다.",
  "성장 리포트 확인: 회차별 수 변화 그래프와 영역별 역량 분석표를 확인합니다.",
  "원본 보기: 선생님의 첨삭이 담긴 PDF 원본을 열람하여 취약점을 보완합니다.",
];

const sharedGuide = [
  "✍️ [강사 / 실장님 공통] 우리 반 아이들 및 학생 배정 관리",
  '"강사님과 실장님 모두 담당 학생들의 반 배정 현황을 직접 제어할 수 있습니다."',
  "① 신규 학생 반 배정 (실시간 매칭)",
  "배정 대상: 가입 신청 후 아직 반이 정해지지 않은 학생들이 목록에 뜹니다.",
  "배정 방법: 학생을 선택하고 해당 수업(반)을 지정하여 [배정] 버튼을 누릅니다.",
  "자동 필터링: 배정이 완료된 학생은 목록에서 즉시 사라지므로, 중복 배정 걱정 없이 명단을 깔끔하게 관리할 수 있습니다.",
  "② 반별 현황 조회 및 조정",
  "현황 보기: [개설된 반 목록]에서 각 반 옆의 [현황 보기]를 누르면, 현재 그 반에 소속된 학생 명단을 한눈에 확인할 수 있습니다.",
  "반 조정: 학생의 수업 시간이 바뀌거나 반을 옮겨야 할 경우, 여기서 학생을 선택해 다른 반으로 재배정하거나 상태를 수정합니다.",
];

const faqItems = [
  {
    icon: User,
    question: "Q. 학생이 가명으로 가입했는데 어떻게 하죠?",
    answer:
      "A. 실장님이 [유저 관리 및 사고 수습] 메뉴에서 해당 학생의 [계정 삭제]를 진행해 주세요. 그 후 학생에게 실명으로 다시 가입하라고 안내하시면 됩니다.",
  },
  {
    icon: Edit,
    question: "Q. 선생님용 가입 코드를 바꿨는데 기존 선생님들은 어떻게 되나요?",
    answer:
      "A. 기존에 가입된 선생님들의 권한은 유지됩니다. 새로 가입하는 분들만 변경된 코드를 사용하면 됩니다.",
  },
  {
    icon: AlertTriangle,
    question: "Q. 배포한 리포트에 점수 오류를 발견했습니다.",
    answer:
      "A. 당황하지 마시고 [배포된 리포트 보관함]에서 해당 건의 [첨삭 내용 수정]을 누르거나, [리포트 회수]를 누른 뒤 다시 등록하시면 됩니다.",
  },
  {
    icon: Search,
    question: 'Q. "표시할 학생이 없습니다"라고 나옵니다.',
    answer:
      "A. [우리 반 아이들] 메뉴의 학생 배정 목록은 아직 반 배정이 안 된 신규 학생만 보여줍니다. 이미 배정된 학생은 반 이름 옆의 [현황 보기]를 눌러 확인하세요.",
  },
];

type ScenePanelProps = {
  eyebrow: string;
  title: string;
  description: string;
  accent: string;
};

const ScenePanel = ({ eyebrow, title, description, accent }: ScenePanelProps) => {
  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(212,175,55,0.24), transparent 28%), radial-gradient(circle at bottom right, rgba(255,255,255,0.08), transparent 25%), linear-gradient(135deg, #001529 0%, #000000 58%, #001529 100%)",
      }}
    >
      <div className="absolute inset-0 opacity-25" style={{ backgroundImage: "linear-gradient(rgba(212,175,55,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.18) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      <div
        className="absolute -right-12 top-10 h-48 w-48 rounded-full blur-3xl"
        style={{ backgroundColor: accent }}
      />
      <div className="relative flex min-h-[360px] flex-col justify-end p-8">
        <div className="mb-4 inline-flex w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs tracking-[0.24em] text-[#D4AF37]">
          {eyebrow}
        </div>
        <h3 className="max-w-xl text-2xl font-semibold leading-snug">{title}</h3>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-200">{description}</p>
      </div>
    </div>
  );
};

const TextBlock = ({ lines, dark = false }: { lines: string[]; dark?: boolean }) => {
  return (
    <div className={`space-y-3 text-base leading-relaxed ${dark ? "text-slate-100" : "text-slate-700"}`}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
};

const Landing = () => {
  return (
    <div className="min-h-screen bg-[#000000] text-white">
      <section className="relative overflow-hidden bg-[#001529]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(212,175,55,0.16),_transparent_30%),linear-gradient(135deg,_rgba(255,255,255,0.05),_transparent_45%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
          <div className="flex flex-col justify-center">
            <div className="mb-5 inline-flex w-fit rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-1 text-xs tracking-[0.26em] text-[#D4AF37]">
              KIM YOON HWAN INSTITUTE
            </div>
            <h1 className="max-w-3xl text-4xl font-black leading-tight text-white md:text-6xl">
              김윤환입시연구소 스마트 첨삭 시스템 [운영 가이드]
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-200">
              본 지침서는 시스템의 데이터 무결성과 관리 보안을 위해 작성되었습니다. 모든 운영진은 아래 절차를 준수해 주시기 바랍니다.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="border border-[#D4AF37] bg-[#D4AF37] px-7 text-[#001529] hover:bg-[#e7c861]"
                size="lg"
              >
                <Link to="/login">데이터 리포트 로그인</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-white/20 bg-white/5 px-7 text-white hover:bg-white/10"
              >
                <a href="http://pf.kakao.com/_Glxodn/chat" target="_blank" rel="noreferrer">
                  이용 문의 및 장애 신고
                </a>
              </Button>
            </div>
          </div>

          <ScenePanel
            eyebrow="DAECHI DAWN ESSAY LAB"
            title="대치동 새벽, 불 켜진 강의실에서 논술 답안을 작성하는 수험생들의 모습 위에 미세한 Gold 데이터 그리드가 겹쳐지는 몽환적인 스케치"
            description="Deep Navy와 Gold 라이트를 겹쳐 입시 연구소의 집중감과 데이터 기반 운영 이미지를 동시에 표현한 메인 비주얼입니다."
            accent="#D4AF37"
          />
        </div>
      </section>

      <section className="bg-white px-6 py-16 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-full bg-[#001529] p-3 text-[#D4AF37]">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-[0.2em] text-[#D4AF37]">ESSENTIAL POLICY</p>
              <h2 className="text-3xl font-bold text-[#001529]">1. 전 사용자 공통 필수 수칙</h2>
            </div>
          </div>
          <div className="rounded-[28px] border border-[#D4AF37]/30 bg-[linear-gradient(135deg,_rgba(0,21,41,0.04),_rgba(212,175,55,0.08))] p-8 shadow-[0_24px_60px_rgba(0,21,41,0.08)]">
            <TextBlock lines={commonRules} />
          </div>
        </div>
      </section>

      <section className="bg-[#001529] px-6 py-16 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <p className="text-sm font-semibold tracking-[0.2em] text-[#D4AF37]">ROLE GUIDE</p>
            <h2 className="mt-2 text-3xl font-bold text-white">권한별 가이드</h2>
          </div>

          <Tabs defaultValue="manager" className="w-full">
            <TabsList className="h-auto w-full flex-wrap gap-2 rounded-2xl bg-white/10 p-2">
              <TabsTrigger value="manager" className="rounded-xl px-5 py-3 data-[state=active]:bg-[#D4AF37] data-[state=active]:text-[#001529]">
                실장님/관리자
              </TabsTrigger>
              <TabsTrigger value="teacher" className="rounded-xl px-5 py-3 data-[state=active]:bg-[#D4AF37] data-[state=active]:text-[#001529]">
                강사
              </TabsTrigger>
              <TabsTrigger value="student" className="rounded-xl px-5 py-3 data-[state=active]:bg-[#D4AF37] data-[state=active]:text-[#001529]">
                학생
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manager">
              <div className="grid gap-8 pt-8 lg:grid-cols-[1.05fr_0.95fr]">
                <TextBlock lines={managerGuide} dark />
                <ScenePanel
                  eyebrow="CONTROL DESK"
                  title="학원 데스크, 복잡한 시간표 사이로 보안 코드를 입력하고 반 배정을 제어하는 실장님의 손."
                  description="보안, 반 배정, 사고 수습이 동시에 이뤄지는 운영 허브 이미지를 연구소 톤으로 구성했습니다."
                  accent="#D4AF37"
                />
              </div>
            </TabsContent>

            <TabsContent value="teacher">
              <div className="grid gap-8 pt-8 lg:grid-cols-[1.05fr_0.95fr]">
                <TextBlock lines={teacherGuide} dark />
                <ScenePanel
                  eyebrow="FEEDBACK WORKFLOW"
                  title="빨간 펜 첨삭 답안지 뭉치 옆에서 PDF를 생성하고 데이터를 전송하는 강사의 모습."
                  description="첨삭 완료 후 시스템에 업로드하고 학생에게 전달하는 강사의 실무 동선을 시각적으로 풀어낸 패널입니다."
                  accent="#b91c1c"
                />
              </div>
            </TabsContent>

            <TabsContent value="student">
              <div className="grid gap-8 pt-8 lg:grid-cols-[1.05fr_0.95fr]">
                <TextBlock lines={studentGuide} dark />
                <ScenePanel
                  eyebrow="STUDENT ANALYTICS"
                  title="독서실 책상, 쌓인 문제집 사이로 태블릿 성적 그래프를 응시하는 진지한 수험생의 옆모습."
                  description="학생이 자신의 성장 리포트를 확인하는 순간을 데이터 패널과 함께 정제된 스타일로 담아냈습니다."
                  accent="#1d4ed8"
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <section className="bg-white px-6 py-16 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-full bg-[#001529] p-3 text-[#D4AF37]">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-[0.2em] text-[#D4AF37]">SHARED OPERATION</p>
              <h2 className="text-3xl font-bold text-[#001529]">우리 반 아이들 및 학생 배정 관리</h2>
            </div>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <TextBlock lines={sharedGuide} />
          </div>
        </div>
      </section>

      <section className="bg-[#000000] px-6 py-16 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <p className="text-sm font-semibold tracking-[0.2em] text-[#D4AF37]">FAQ</p>
            <h2 className="mt-2 text-3xl font-bold text-white">❓ 자주 묻는 질문 (FAQ)</h2>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#001529] p-6 shadow-[0_28px_70px_rgba(0,0,0,0.4)]">
            <Accordion type="single" collapsible className="w-full">
              {faqItems.map((item) => {
                const Icon = item.icon;
                return (
                  <AccordionItem key={item.question} value={item.question} className="border-white/10">
                    <AccordionTrigger className="gap-4 text-left text-base text-white hover:no-underline">
                      <span className="flex items-center gap-3">
                        <span className="rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-2 text-[#D4AF37]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span>{item.question}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pl-14 text-base leading-relaxed text-slate-200">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#001529] px-6 py-10 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-sm leading-relaxed text-slate-200">
            본 시스템은 '시험 날짜'를 기준으로 데이터를 관리하며, 반드시 Chrome 브라우저 최신 버전 사용을 권장합니다.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
