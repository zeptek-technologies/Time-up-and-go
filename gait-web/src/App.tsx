import { useEffect, useRef, useState } from "react";
import Header, { SECTIONS, type SectionKey } from "./components/Header";
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
import "./app-shell.css";
// Loaded last: owns the visual direction (see console.css header).
import "./console.css";
import "./patient-management.css";

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

  const navigate = (key: SectionKey) => {
    navClick.current = true;
    setActive(key);
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      <Header active={active} onNavigate={navigate} />

      <main className="page-main">
        <PendingUploadsBanner />
        <section id="sec-overview" className="page-block">
          <OverviewSection data={data} />
        </section>
        <section id="sec-patients" className="page-block">
          <PatientsSection data={data} activePatientId={activePatientId} setActivePatientId={setActivePatientId} />
        </section>
        <section id="sec-camera" className="page-block">
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
