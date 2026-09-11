import profileAvatar from "../assets/profile-user-avatar-man-person-svgrepo-com.svg";
import "./patient-avatar.css";

/** Use recorded gender only; never infer it from a person's name. */
export default function PatientAvatar({ gender, size = "small" }: {
  gender?: string; size?: "small" | "large";
}) {
  const tone = gender === "หญิง" ? "female" : gender === "ชาย" ? "male" : "neutral";
  return (
    <span className={`patient-avatar patient-avatar--${tone} patient-avatar--${size}`} aria-hidden="true">
      <img src={profileAvatar} alt="" />
    </span>
  );
}
