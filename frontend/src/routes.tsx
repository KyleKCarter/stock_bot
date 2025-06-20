import React from 'react';
import {Routes, Route} from 'react-router-dom';

//pages

const AppRoutes: React.FC = () => (
    <Routes>
        <Route path="/" element={<div>Home Page</div>} />
    </Routes>
)

export default AppRoutes;