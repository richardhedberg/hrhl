import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import AnalyticsDashboardPage from "@/pages/AnalyticsDashboardPage";
import ArticlePage from "@/pages/ArticlePage";
import Error401Page from "@/pages/Error401Page";
import Error404Page from "@/pages/Error404Page";
import HomePage from "@/pages/HomePage";
import StatsPage from "@/pages/StatsPage";
import StyleGuidePage from "@/pages/StyleGuidePage";
import TeamsPage from "@/pages/TeamsPage";
import VideosPage from "@/pages/VideosPage";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/videos" element={<VideosPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/style-guide" element={<StyleGuidePage />} />
        <Route path="/articles/:slug" element={<ArticlePage />} />
        <Route path="/dashboard" element={<AnalyticsDashboardPage />} />
        <Route path="/401" element={<Error401Page />} />
        <Route path="/404" element={<Error404Page />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;

