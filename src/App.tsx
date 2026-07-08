import { Navigate, Route, Routes } from "react-router-dom";

import { Shell } from "@/components/shell/Shell";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { EditorScreen } from "@/screens/EditorScreen";
import { GraphScreen } from "@/screens/GraphScreen";
import { AssistantScreen } from "@/screens/AssistantScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<DashboardScreen />} />
        <Route path="editor" element={<EditorScreen />} />
        <Route path="editor/:id" element={<EditorScreen />} />
        <Route path="graph" element={<GraphScreen />} />
        <Route path="assistant" element={<AssistantScreen />} />
        <Route path="assistant/:id" element={<AssistantScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
