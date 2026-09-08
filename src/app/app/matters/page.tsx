'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/context';
import {
  loadMatters,
  saveMatters,
  createMatter,
  loadClients,
} from '@/lib/data/repository';
import {
  DEFAULT_STATE,
  CASE_CATEGORIES,
  type CaseCategory,
  getDistricts,
  addCustomDistrict,
  getCourtComplexes,
  addCustomCourtComplex,
  getCaseTypes,
  addCustomCaseType,
  getRecentYears,
} from '@/lib/data/ecourtsData';
import type { Matter, Client, MatterStatus } from '@/lib/types/database';

function MattersContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const clientFilterParam = searchParams.get('client');

  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Add Case Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDisposalModal, setShowDisposalModal] = useState(false);
  const [disposalTargetMatter, setDisposalTargetMatter] = useState<Matter | null>(null);
  const [disposalDate, setDisposalDate] = useState('');
  const [finalOrderSummary, setFinalOrderSummary] = useState('');

  // Form states for new case
  const [selectedClientId, setSelectedClientId] = useState(clientFilterParam || '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CaseCategory>('Civil');
  const [caseType, setCaseType] = useState('');
  const [state, setState] = useState(DEFAULT_STATE);
  const [district, setDistrict] = useState('Visakhapatnam');
  const [courtComplex, setCourtComplex] = useState('Visakhapatnam District Court Complex');
  const [caseNumber, setCaseNumber] = useState('');
  const [caseYear, setCaseYear] = useState<string>(new Date().getFullYear().toString());
  const [nextHearingDate, setNextHearingDate] = useState('');
  const [hearingPurpose, setHearingPurpose] = useState('');

  // Inline "Add New" states
  const [showNewCaseTypeInput, setShowNewCaseTypeInput] = useState(false);
  const [newCaseTypeVal, setNewCaseTypeVal] = useState('');
  const [showNewDistrictInput, setShowNewDistrictInput] = useState(false);
  const [newDistrictVal, setNewDistrictVal] = useState('');
  const [showNewComplexInput, setShowNewComplexInput] = useState(false);
  const [newComplexVal, setNewComplexVal] = useState('');

  // Options
  const [districtsList, setDistrictsList] = useState<string[]>([]);
  const [complexesList, setComplexesList] = useState<string[]>([]);
  const [caseTypesList, setCaseTypesList] = useState<string[]>([]);
  const recentYears = getRecentYears();

  const refreshData = () => {
    setMatters(loadMatters());
    setClients(loadClients().filter((c) => c.status === 'active'));
  };

  useEffect(() => {
    refreshData();
    const handleUpdate = () => refreshData();
    window.addEventListener('vakildesk-matters-update', handleUpdate);
    return () => window.removeEventListener('vakildesk-matters-update', handleUpdate);
  }, []);

  // Sync districts
  useEffect(() => {
    setDistrictsList(getDistricts());
  }, []);

  // When category changes, update case types list
  useEffect(() => {
    const types = getCaseTypes(category);
    setCaseTypesList(types);
    setCaseType(types[0] || '');
    setShowNewCaseTypeInput(false);
  }, [category]);

  // When district changes, update court complexes list
  useEffect(() => {
    const complexes = getCourtComplexes(district);
    setComplexesList(complexes);
    setCourtComplex(complexes[0] || '');
    setShowNewComplexInput(false);
  }, [district]);

  // Handle inline custom district add
  const handleAddCustomDistrict = () => {
    if (!newDistrictVal.trim()) return;
    const updated = addCustomDistrict(newDistrictVal);
    setDistrictsList(updated);
    setDistrict(newDistrictVal.trim());
    setNewDistrictVal('');
    setShowNewDistrictInput(false);
  };

  // Handle inline custom court complex add
  const handleAddCustomComplex = () => {
    if (!newComplexVal.trim()) return;
    const updated = addCustomCourtComplex(district, newComplexVal);
    setComplexesList(updated);
    setCourtComplex(newComplexVal.trim());
    setNewComplexVal('');
    setShowNewComplexInput(false);
  };

  // Handle inline custom case type add
  const handleAddCustomCaseType = () => {
    if (!newCaseTypeVal.trim()) return;
    const updated = addCustomCaseType(category, newCaseTypeVal);
    setCaseTypesList(updated);
    setCaseType(newCaseTypeVal.trim());
    setNewCaseTypeVal('');
    setShowNewCaseTypeInput(false);
  };

  // Create Case
  const handleCreateCase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !title.trim() || !caseNumber.trim()) return;

    const formattedMatterNo = `${caseType.split(' ')[0]} ${caseNumber}/${caseYear}`;

    createMatter({
      client_id: selectedClientId,
      title: title.trim(),
      matter_number: formattedMatterNo,
      category,
      case_type: caseType,
      state,
      district,
      court_complex: courtComplex,
      court_name: `${courtComplex}, ${district}`,
      case_year: caseYear,
      next_hearing_date: nextHearingDate ? new Date(nextHearingDate).toISOString() : null,
      status: 'Active',
    });

    // Reset form
    setTitle('');
    setCaseNumber('');
    setNextHearingDate('');
    setShowAddModal(false);
    refreshData();
  };

  // Handle Disposed/Closed state transition
  const handleSaveDisposal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposalTargetMatter || !disposalDate || !finalOrderSummary.trim()) return;

    const all = loadMatters();
    const idx = all.findIndex((m) => m.id === disposalTargetMatter.id);
    if (idx !== -1) {
      all[idx] = {
        ...all[idx],
        status: 'Disposed/Closed',
        disposal_date: disposalDate,
        final_order_summary: finalOrderSummary.trim(),
        updated_at: new Date().toISOString(),
      };
      saveMatters(all);
    }

    setShowDisposalModal(false);
    setDisposalTargetMatter(null);
    setDisposalDate('');
    setFinalOrderSummary('');
    refreshData();
  };

  // Filtered matters
  const filteredMatters = matters.filter((m) => {
    if (clientFilterParam && m.client_id !== clientFilterParam) return false;
    if (selectedCategoryFilter !== 'All' && m.category !== selectedCategoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = m.title.toLowerCase().includes(q);
      const matchNum = m.matter_number.toLowerCase().includes(q);
      const matchCourt = m.court_name.toLowerCase().includes(q);
      if (!matchTitle && !matchNum && !matchCourt) return false;
    }
    return true;
  });

  const getClientName = (cid: string) => {
    const c = clients.find((item) => item.id === cid);
    return c ? c.name : 'Client';
  };

  return (
    <div>
      <div className="section-label">{t('cases')}</div>

      {/* Top Action Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className="action-btn action-btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => {
            if (clientFilterParam) setSelectedClientId(clientFilterParam);
            setShowAddModal(true);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add Case</span>
        </button>

        <Link
          href="/clients"
          className="action-btn"
          style={{ justifyContent: 'center', textDecoration: 'none' }}
        >
          <span>Client Directory →</span>
        </Link>
      </div>

      {/* Category Filter Pills: All, Civil, Crime, Family, NIA */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 12 }}>
        {['All', ...CASE_CATEGORIES].map((cat) => (
          <button
            key={cat}
            type="button"
            className={`action-btn ${selectedCategoryFilter === cat ? 'action-btn-primary' : ''}`}
            style={{ padding: '6px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
            onClick={() => setSelectedCategoryFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          className="input-field"
          placeholder="Search by case number, title, or court…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ margin: 0 }}
        />
      </div>

      {/* Client Filter Pill active warning */}
      {clientFilterParam && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--bg-surface-elevated)', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: '0.82rem' }}>
          <span>Filtered for: <strong>{getClientName(clientFilterParam)}</strong></span>
          <Link href="/matters" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>
            Clear filter ✕
          </Link>
        </div>
      )}

      {/* Case List */}
      {filteredMatters.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            {searchQuery
              ? 'No cases match your search criteria.'
              : 'No cases recorded yet. Tap "+ Add Case" to classify a client matter with court hierarchy.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredMatters.map((m) => {
            const isDisposed = m.status === 'Disposed/Closed';
            return (
              <div key={m.id} className="card" style={{ marginBottom: 0 }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 4,
                        backgroundColor: m.category === 'Crime' ? 'var(--status-danger-bg)' : m.category === 'Family' ? 'var(--status-warning-bg)' : 'var(--accent-primary-dim)',
                        color: m.category === 'Crime' ? 'var(--status-danger)' : m.category === 'Family' ? 'var(--status-warning)' : 'var(--accent-primary)',
                        marginBottom: 4,
                      }}
                    >
                      {m.category || 'Civil'} • {m.case_type}
                    </span>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                      {m.matter_number}
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: '0.72rem',
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontWeight: 600,
                      backgroundColor: isDisposed ? 'var(--status-success-bg)' : 'var(--status-warning-bg)',
                      color: isDisposed ? 'var(--status-success)' : 'var(--status-warning)',
                    }}
                  >
                    {m.status}
                  </span>
                </div>

                {/* Title / Cause Title */}
                <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 8, fontWeight: 500 }}>
                  {m.title}
                </div>

                {/* Court Hierarchy Info */}
                <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
                  <div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline',verticalAlign:'middle',marginRight:4}} aria-hidden="true"><rect width="16" height="10" x="4" y="10" rx="1"/><path d="M12 2L2 7h20L12 2z"/><line x1="6" y1="10" x2="6" y2="20"/><line x1="10" y1="10" x2="10" y2="20"/><line x1="14" y1="10" x2="14" y2="20"/><line x1="18" y1="10" x2="18" y2="20"/></svg><strong>{m.court_complex || m.court_name}</strong></div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {m.district}, {m.state || 'Andhra Pradesh'}
                  </div>
                  <div style={{ marginTop: 4, fontSize: '0.78rem' }}>
                    Client: <strong style={{ color: 'var(--text-primary)' }}>{getClientName(m.client_id)}</strong>
                  </div>
                </div>

                {/* Next Hearing Countdown if Active */}
                {!isDisposed && m.next_hearing_date && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--status-warning)', marginBottom: 10, fontWeight: 600 }}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:4}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>Next Hearing:</span>
                    <span>
                      {new Date(m.next_hearing_date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                )}

                {/* Disposed Info */}
                {isDisposed && m.disposal_date && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--status-success)', marginBottom: 10 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline',verticalAlign:'middle',marginRight:4}} aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Disposed on {new Date(m.disposal_date).toLocaleDateString('en-IN')} — "{m.final_order_summary}"
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                  <Link
                    href={`/app/diary?matter=${m.id}`}
                    className="action-btn"
                    style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem', textDecoration: 'none' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:4}} aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Case Notes
                  </Link>

                  {!isDisposed && (
                    <button
                      type="button"
                      className="action-btn"
                      style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem' }}
                      onClick={() => {
                        setDisposalTargetMatter(m);
                        setDisposalDate(new Date().toISOString().slice(0, 10));
                        setShowDisposalModal(true);
                      }}
                    >
                      Mark Disposed
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal: Add Case (Cascading Hierarchy) ── */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 460,
              maxHeight: '90vh',
              overflowY: 'auto',
              marginBottom: 0,
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                Add Case & Court Classification
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCase}>
              {/* Select Client */}
              <label className="input-label">Select Client *</label>
              {clients.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--status-warning)', marginBottom: 12 }}>
                  No active clients found. Please add or onboard a client first.
                </div>
              ) : (
                <select
                  className="input-field"
                  required
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                >
                  <option value="">-- Choose Active Client --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              )}

              {/* Case Title / Parties */}
              <label className="input-label">Case Title / Cause Title *</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Ramesh vs State of AP or Injunction Suit"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {/* 1. Case Category */}
              <label className="input-label">Case Category (Single Select) *</label>
              <select
                className="input-field"
                value={category}
                onChange={(e) => setCategory(e.target.value as CaseCategory)}
              >
                {CASE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              {/* 2. Cascading Case Type with Inline Add */}
              <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Case Type ({category}) *</span>
                <button
                  type="button"
                  onClick={() => setShowNewCaseTypeInput(!showNewCaseTypeInput)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  {showNewCaseTypeInput ? 'Cancel' : '+ Add custom'}
                </button>
              </label>

              {showNewCaseTypeInput ? (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Enter custom case type…"
                    value={newCaseTypeVal}
                    onChange={(e) => setNewCaseTypeVal(e.target.value)}
                    style={{ margin: 0 }}
                  />
                  <button
                    type="button"
                    className="action-btn action-btn-primary"
                    onClick={handleAddCustomCaseType}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  className="input-field"
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                >
                  {caseTypesList.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}

              {/* 3. State (Default Andhra Pradesh, real field) */}
              <label className="input-label">State</label>
              <input
                type="text"
                className="input-field"
                value={state}
                onChange={(e) => setState(e.target.value)}
              />

              {/* 4. Cascading District (13 AP Judicial Districts) with Inline Add */}
              <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Judicial District *</span>
                <button
                  type="button"
                  onClick={() => setShowNewDistrictInput(!showNewDistrictInput)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  {showNewDistrictInput ? 'Cancel' : '+ Add district'}
                </button>
              </label>

              {showNewDistrictInput ? (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Custom judicial district…"
                    value={newDistrictVal}
                    onChange={(e) => setNewDistrictVal(e.target.value)}
                    style={{ margin: 0 }}
                  />
                  <button
                    type="button"
                    className="action-btn action-btn-primary"
                    onClick={handleAddCustomDistrict}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  className="input-field"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                >
                  {districtsList.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}

              {/* 5. Cascading Court Complex with Inline Add */}
              <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Court Complex (eCourts) *</span>
                <button
                  type="button"
                  onClick={() => setShowNewComplexInput(!showNewComplexInput)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  {showNewComplexInput ? 'Cancel' : '+ Add complex'}
                </button>
              </label>

              {showNewComplexInput ? (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Custom court complex…"
                    value={newComplexVal}
                    onChange={(e) => setNewComplexVal(e.target.value)}
                    style={{ margin: 0 }}
                  />
                  <button
                    type="button"
                    className="action-btn action-btn-primary"
                    onClick={handleAddCustomComplex}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  className="input-field"
                  value={courtComplex}
                  onChange={(e) => setCourtComplex(e.target.value)}
                >
                  {complexesList.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}

              {/* 6. Case Number and Year */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 2 }}>
                  <label className="input-label">Case Number *</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. 142"
                    required
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="input-label">Year *</label>
                  <select
                    className="input-field"
                    value={caseYear}
                    onChange={(e) => setCaseYear(e.target.value)}
                  >
                    {recentYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Next Hearing Date (Optional) */}
              <label className="input-label">Next Hearing Date</label>
              <input
                type="date"
                className="input-field"
                value={nextHearingDate}
                onChange={(e) => setNextHearingDate(e.target.value)}
              />

              <button
                type="submit"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
                disabled={clients.length === 0}
              >
                Save & Classify Case
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Disposed / Closed Enforcement ── */}
      {showDisposalModal && disposalTargetMatter && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 420,
              marginBottom: 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                Mark Matter as Disposed/Closed
              </div>
              <button
                type="button"
                onClick={() => setShowDisposalModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              Per legal practice compliance, shifting to <strong>Disposed/Closed</strong> requires an order date and final summary.
            </p>

            <form onSubmit={handleSaveDisposal}>
              <label className="input-label">Disposal Date *</label>
              <input
                type="date"
                className="input-field"
                required
                value={disposalDate}
                onChange={(e) => setDisposalDate(e.target.value)}
              />

              <label className="input-label">Final Order Summary / Judgment Outcome *</label>
              <textarea
                className="input-field"
                rows={3}
                placeholder="e.g. Suit decreed in favour of plaintiff; Bail allowed on furnishing surety bond."
                required
                value={finalOrderSummary}
                onChange={(e) => setFinalOrderSummary(e.target.value)}
              />

              <button
                type="submit"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
              >
                Confirm Disposal
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MattersPage() {
  return (
    <Suspense fallback={<div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading court matters…</div>}>
      <MattersContent />
    </Suspense>
  );
}
