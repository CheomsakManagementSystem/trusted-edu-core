import { Link } from "react-router-dom";
import BrandLogo from "@/components/BrandLogo";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Chrome, CalendarDays, GraduationCap, Search, ShieldCheck, User, Edit, AlertTriangle } from "lucide-react";

const quickRules = [
  {
    icon: Chrome,
    title: "크롬 권장",
    description: "반드시 Google Chrome(크롬) 최신 버전 사용을 권장합니다.(컴퓨터 로그인 기준)",
  },
  {
    icon: User,
    title: "실명 가입",
    description: "학생과 강사 모두 학원에 등록된 실명으로 가입해야 합니다. (데이터 누락 방지)",
  },
  {
    icon: ShieldCheck,
    title: "로그인 보안",
    description: "최초 가입 시 권한별 초대 코드 입력 필수 / 비밀번호 분실 시 [계정 삭제 후 재가입] 원칙",
  },
];

const roleGuides = [
  {
    icon: ShieldCheck,
    title: "실장/관리자",
    summary: "유저 사고 수습, 강의실 개설, 학생 배정, 마스터 보안과 알림 설정까지 전체 운영을 관리합니다.",
    bullets: [
      "가입된 모든 유저의 이름, 이메일, 고유ID를 확인하고 문제 계정을 삭제합니다.",
      "신규 학생을 반에 배정하고, 개설된 수업의 요일·시간·명칭을 조정합니다.",
      "학생 리포트 상세 조회를 통해 실제 점수와 강사 총평을 상담 자료로 확인합니다.",
    ],
  },
  {
    icon: Edit,
    title: "강사",
    summary: "4단계 리포트 등록 절차를 기준으로 첨삭 PDF를 검수 후 학생에게 안전하게 전달합니다.",
    bullets: [
      "1단계: 반 선택",
      "2단계: 파일 등록",
      "3단계: 내용 확인",
      "4단계: 학생에게 발송",
    ],
  },
  {
    icon: GraduationCap,
    title: "학생",
    summary: "반 가입 신청 후 성장 리포트, 점수 변화, 첨삭 PDF 원본을 확인하며 학습에 활용합니다.",
    bullets: [
      "실장님의 승인을 받아 수강 반에 가입합니다.",
      "점수 변화 그래프와 영역별 역량 분석표를 확인합니다.",
      "PDF 원본 첨삭을 열람해 취약점을 보완합니다.",
    ],
  },
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

const DataVisual = () => {
  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-[28px] border border-[#d9e2ec] bg-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(24,144,255,0.18),_transparent_22%),linear-gradient(180deg,_rgba(24,144,255,0.06),_rgba(255,255,255,0))]" />
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(rgba(24,144,255,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(24,144,255,0.10) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <div className="absolute left-12 top-12 h-28 w-28 rounded-full bg-[#1890FF]/10 blur-3xl" />
      <div className="absolute bottom-10 right-12 h-36 w-36 rounded-full bg-[#001529]/10 blur-3xl" />
      <div className="relative flex h-full flex-col justify-between p-8">
        <div className="flex items-center gap-3">
          <div className="h-2 w-14 rounded-full bg-[#001529]/15" />
          <div className="h-2 w-10 rounded-full bg-[#1890FF]/40" />
        </div>
        <div className="space-y-4">
          <div className="rounded-3xl border border-[#d9e2ec] bg-white/90 p-5 shadow-sm">
            <div className="mb-4 flex items-end gap-3">
              <div className="h-12 w-3 rounded-full bg-[#001529]" />
              <div className="h-20 w-3 rounded-full bg-[#1890FF]" />
              <div className="h-10 w-3 rounded-full bg-[#69c0ff]" />
              <div className="h-24 w-3 rounded-full bg-[#001529]" />
              <div className="h-16 w-3 rounded-full bg-[#1890FF]" />
            </div>
            <div className="h-2 w-28 rounded-full bg-[#001529]/12" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-[#d9e2ec] bg-[#f7fbff] p-4">
              <div className="h-2 w-10 rounded-full bg-[#1890FF]" />
              <div className="mt-5 h-9 rounded-xl bg-[#1890FF]/12" />
            </div>
            <div className="rounded-2xl border border-[#d9e2ec] bg-[#f7fbff] p-4">
              <div className="h-2 w-12 rounded-full bg-[#001529]" />
              <div className="mt-5 h-9 rounded-xl bg-[#001529]/10" />
            </div>
            <div className="rounded-2xl border border-[#d9e2ec] bg-[#f7fbff] p-4">
              <div className="h-2 w-8 rounded-full bg-[#69c0ff]" />
              <div className="mt-5 h-9 rounded-xl bg-[#69c0ff]/20" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Landing = () => {
  return (
    <div className="min-h-screen bg-[#f4f8fb] text-[#001529]">
      <header className="border-b border-[#d9e2ec] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <div className="flex items-center gap-4">
            <BrandLogo compact className="text-[#001529]" />
            <div className="hidden sm:block">
              <p className="text-xs font-semibold tracking-[0.24em] text-[#1890FF]">SMART REPORT SYSTEM</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" className="text-[#001529] hover:bg-[#f3f7fb]">
              <Link to="/login">로그인</Link>
            </Button>
            <Button asChild className="bg-[#001529] text-white hover:bg-[#00284a]">
              <Link to="/register">회원가입</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <section className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 overflow-hidden rounded-[32px] border border-[#d9e2ec] bg-white shadow-[0_24px_60px_rgba(0,21,41,0.10)]">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col justify-between bg-[#001529] px-8 py-10 text-white md:px-12 md:py-12">
              <div>
                <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-1 text-xs font-semibold tracking-[0.2em] text-[#69c0ff]">
                  SMART REPORT SYSTEM
                </div>
                <h1 className="mt-6 text-4xl font-black tracking-tight md:text-6xl">
                  당신의 통찰, 데이터로 증명되는 합격의 확신.
                </h1>
                <p className="mt-6 text-lg leading-relaxed text-slate-200">
                  깊이 있는 사고의 궤적을 숫자로 기록합니다. 이제 논술의 성장을 시각적으로 확인하세요.
                </p>
              </div>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="bg-[#1890FF] text-white hover:bg-[#1677d9]">
                  <Link to="/login">나의 리포트 로그인</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                >
                  <a href="http://pf.kakao.com/_Glxodn/chat" target="_blank" rel="noreferrer">
                    이용 문의 및 장애 신고
                  </a>
                </Button>
              </div>
            </div>

            <div className="bg-white p-6 md:p-8">
              <DataVisual />
            </div>
          </div>
        </section>

        <section className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 grid gap-6 py-16 lg:grid-cols-3">
          {quickRules.map((rule) => {
            const Icon = rule.icon;
            return (
              <div
                key={rule.title}
                className="rounded-[28px] border border-[#d9e2ec] bg-white p-8 shadow-[0_18px_40px_rgba(0,21,41,0.08)]"
              >
                <div className="inline-flex rounded-2xl bg-[#f3f7fb] p-3 text-[#1890FF]">
                  <Icon className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#001529]">{rule.title}</h2>
                <p className="mt-4 text-base leading-relaxed text-[#4b5b6a]">{rule.description}</p>
              </div>
            );
          })}
        </section>

        <section className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 rounded-[32px] border border-[#d9e2ec] bg-white p-8 shadow-[0_18px_40px_rgba(0,21,41,0.08)]">
          <h2 className="text-3xl font-bold tracking-tight text-[#001529]">운영 가이드 요약</h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {roleGuides.map((guide) => {
              const Icon = guide.icon;
              return (
                <div key={guide.title} className="rounded-[24px] border border-[#d9e2ec] bg-[#f9fbfd] p-6">
                  <div className="inline-flex rounded-2xl bg-[#001529] p-3 text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-xl font-bold tracking-tight text-[#001529]">{guide.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#4b5b6a]">{guide.summary}</p>
                  <div className="mt-5 space-y-3">
                    {guide.bullets.map((bullet) => (
                      <div key={bullet} className="flex gap-3 text-sm leading-relaxed text-[#001529]">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1890FF]" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 mt-8 rounded-[32px] border border-[#d9e2ec] bg-[#001529] p-8 text-white shadow-[0_18px_40px_rgba(0,21,41,0.12)]">
          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight">운영 핵심</h2>
            <p className="mt-3 text-base leading-relaxed text-slate-200">
              실명 가입 원칙, 비밀번호 분실 시 재가입(팀장 문의), 시험 날짜 기반 관리 원칙을 중심으로 시스템을 운영합니다.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-6">
              <Chrome className="h-6 w-6 text-[#69c0ff]" />
              <h3 className="mt-4 text-lg font-bold">크롬 권장</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">
                컴퓨터 로그인 기준으로 반드시 Google Chrome 최신 버전 사용을 권장합니다.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-6">
              <User className="h-6 w-6 text-[#69c0ff]" />
              <h3 className="mt-4 text-lg font-bold">실명 가입</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">
                학생과 강사 모두 학원에 등록된 실명으로 가입해야 데이터 누락을 막을 수 있습니다.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-6">
              <CalendarDays className="h-6 w-6 text-[#69c0ff]" />
              <h3 className="mt-4 text-lg font-bold">4단계 리포트 등록</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">
                반 선택, 파일 등록, 내용 확인, 학생에게 발송 순서로 검수와 전송을 진행합니다.
              </p>
            </div>
          </div>
        </section>

        <section className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 mt-16 rounded-[32px] border border-[#d9e2ec] bg-white p-8 shadow-[0_18px_40px_rgba(0,21,41,0.08)]">
          <h2 className="text-3xl font-bold tracking-tight text-[#001529]">❓ 자주 묻는 질문 (FAQ)</h2>
          <Accordion type="single" collapsible className="mt-8 w-full">
            {faqItems.map((item) => {
              const Icon = item.icon;
              return (
                <AccordionItem key={item.question} value={item.question} className="border-[#d9e2ec]">
                  <AccordionTrigger className="gap-4 text-left text-base font-semibold text-[#001529] hover:no-underline">
                    <span className="flex items-center gap-3">
                      <span className="rounded-full border border-[#d9e2ec] bg-[#f3f7fb] p-2 text-[#1890FF]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>{item.question}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pl-14 text-base leading-relaxed text-[#4b5b6a]">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </section>

        <section className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 mt-8 rounded-[32px] border border-[#d9e2ec] bg-white p-8 shadow-[0_18px_40px_rgba(0,21,41,0.08)]">
          <h2 className="text-3xl font-bold tracking-tight text-[#001529]">시스템 이용 및 장애 문의</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#4b5b6a]">
            시스템 이용 중 에러가 발생하거나 궁금한 점이 있으신가요? 김윤환입시연구소 지원팀이 신속하게 도와드립니다.
          </p>
          <div className="mt-6">
            <Button asChild size="lg" className="bg-[#1890FF] text-white hover:bg-[#1677d9]">
              <a href="http://pf.kakao.com/_Glxodn/chat" target="_blank" rel="noreferrer">
                카카오톡 실시간 상담 연결
              </a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#d9e2ec] bg-white px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-7xl text-sm leading-relaxed text-[#4b5b6a]">
          최상의 환경을 위해 Google Chrome 최신 버전 사용을 권장합니다. 모든 데이터는 시험 날짜를 기준으로 관리됩니다.
        </div>
      </footer>
    </div>
  );
};

export default Landing;
