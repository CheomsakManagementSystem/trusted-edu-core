import { useState } from "react";
import AdminLayout, {
  AdminSectionKey,
} from "@/components/admin/AdminLayout";
import ClassMaterialSection from "@/components/admin/ClassMaterialSection";
import StudentAssignmentSection from "@/components/admin/StudentAssignmentSection";
import AdminSettingsSection from "@/components/admin/AdminSettingsSection";

const AdminDashboard = () => {
  const [section, setSection] = useState<AdminSectionKey>("classes");

  const renderSection = () => {
    switch (section) {
      case "classes":
        return <ClassMaterialSection />;
      case "students":
        return <StudentAssignmentSection />;
      case "settings":
        return <AdminSettingsSection />;
      default:
        return null;
    }
  };

  return (
    <AdminLayout section={section} onSectionChange={setSection}>
      {renderSection()}
    </AdminLayout>
  );
};

export default AdminDashboard;

