import { useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import { SECTIONS, type SectionKey } from "./lib/navigation";
import CameraPage from "./components/CameraPage";
import OverviewSection from "./components/OverviewSection";
import PatientsSection from "./components/PatientsSection";
import RecordsSection from "./components/RecordsSection";
import DiseaseSection from "./components/DiseaseSection";
import GuideSection from "./components/GuideSection";
import LiveStatusPage from "./components/LiveStatusPage";
import PatientManagementPage from "./components/PatientManagementPage";
import PendingUploadsBanner from "./components/PendingUploadsBanner";
import { useTugData } from "./hooks/useTugData";
import { setActiveSubject } from "./lib/firebase";
import "./app-shell.css";
// Loaded last: owns the visual direction (see console.css header).
import "./console.css";
import "./patient-management.css";
import "./redesign.css";

export default function App() {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "live-status") return <LiveStatusPage />;
  if (view === "patients") return <PatientManagementPage />;
  return <DashboardApp />;
}

function DashboardApp() {
  const data = useTugData();
  const [activePatientId, setActivePatientId] = useState("");
  const [active, setActive] = useState<SectionKey>("overview");
  const activePatientName = data.patientName(activePatientId);
  const navClick = useRef(false);

  // Announce the selection so the live-status screen (a different page, often a
  // different device) knows whose round this is — and so the chair stamps
  // tug_results with the same subject. See setActiveSubject() for why every call
  // starts a new session: pick the subject BEFORE the first trial, not mid-session.
  useEffect(() => {
    if (!activePatientId) return; // "ไม่ระบุ" isn't a selection worth broadcasting
    setActiveSubject(activePatientId, data.patientName(activePatientId) ?? "").catch((err) =>
      console.error("[ActiveSubject]", err),
    );
    // Deliberately keyed on the id alone: renaming a patient must not start a
    // new session and reset the trial counter mid-test.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatientId]);

  const navigate = (key: SectionKey) => {
    navClick.current = true;
    setActive(key);
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    window.setTimeout(() => (navClick.current = false), 700);
  };

  // Scroll-spy: highlight whichever section is currently in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (navClick.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id.replace("sec-", "") as SectionKey);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.2, 0.5, 1] },
    );
    SECTIONS.forEach(({ key }) => {
      const el = document.getElementById(`sec-${key}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a>
      <Header active={active} onNavigate={navigate} />

      <main id="main-content" className="page-main" tabIndex={-1}>
        <PendingUploadsBanner />
        <section id="sec-overview" className="page-block">
          <div className="workspace-intro">
            <div>
              <span className="section-header__eyebrow">TUG / พื้นที่ประเมินการเดิน</span>
              <h1>ภาพรวมการทดสอบ</h1>
              <p>ติดตามผล เลือกผู้ทดสอบ และประเมินการเดินในพื้นที่เดียว</p>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => navigate("camera")}>ไปที่กล้องทดสอบ <span aria-hidden="true">↗</span></button>
          </div>
          <OverviewSection data={data} />
        </section>
        <section id="sec-patients" className="page-block">
          <PatientsSection data={data} activePatientId={activePatientId} setActivePatientId={setActivePatientId} />
        </section>
        <section id="sec-camera" className="page-block">
          <div className="section-header">
            <div><span className="section-header__eyebrow">Gait assessment</span><h2 className="section-header__title">พื้นที่ทดสอบการเดิน</h2></div>
            <span className="workspace-caption">กล้องด้านหน้า + ด้านข้าง</span>
          </div>
          <CameraPage activePatientId={activePatientId} activePatientName={activePatientName} />
        </section>
        <section id="sec-records" className="page-block">
          <RecordsSection data={data} />
        </section>
        <section id="sec-disease" className="page-block">
          <DiseaseSection data={data} />
        </section>
        <section id="sec-guide" className="page-block">
          <GuideSection />
        </section>
      </main>
    </div>
  );
}
