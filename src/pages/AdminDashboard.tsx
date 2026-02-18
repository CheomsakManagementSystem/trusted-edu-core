import { useState } from "react";
import AdminLayout, { AdminSectionKey } from "@/components/admin/AdminLayout";
import ClassMaterialSection from "@/components/admin/ClassMaterialSection";
import StudentAssignmentSection from "@/components/admin/StudentAssignmentSection";
import AdminSettingsSection from "@/components/admin/AdminSettingsSection";
import SyncControlCard from "@/components/admin/SyncControlCard";
import ValidationTable from "@/components/admin/ValidationTable";
import { useDriveSync } from "@/hooks/useDriveSync";

const AdminDashboard = () => {
  const [section, setSection] = useState<AdminSectionKey>("classes");
  const driveSync = useDriveSync();

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
      <div className="space-y-6">
        <SyncControlCard />
        <ValidationTable results={driveSync.results} />
        {renderSection()}
      </div>
    </AdminLayout>
  );
};

export default AdminDashboard;

