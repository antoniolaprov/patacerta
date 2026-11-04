import type { Routes } from '@angular/router';
import { authGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then((m) => m.LoginPage) },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'agenda' },
      { path: 'agenda', loadComponent: () => import('./pages/agenda').then((m) => m.AgendaPage) },
      { path: 'pacientes', loadComponent: () => import('./pages/patients').then((m) => m.PatientsPage) },
      {
        path: 'pacientes/:id',
        loadComponent: () => import('./pages/patient-detail').then((m) => m.PatientDetailPage),
      },
      { path: 'pendencias', loadComponent: () => import('./pages/pending').then((m) => m.PendingPage) },
      {
        path: 'assistente',
        loadComponent: () => import('./pages/assistant-page').then((m) => m.AssistantPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
