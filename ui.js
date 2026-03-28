// ============================================================
// Δ HELIX v3 — UI RENDERING
// ============================================================
 
import { CONFIG } from './config.js';
import { state, t, selectors, actions } from './store.js';

// ========== UTILITY FUNCTIONS ==========

function escapeHTML(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDate(s) {
    if (!s) return '';
    try {
        return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return s;
    }
}

function getClassClass(variant) {
    const cls = variant.cftr_class ? `c${variant.cftr_class.toLowerCase()}` : 'cx';
    return cls;
}

function showNotification(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('notification-container');
    if (!container) return;
    
    const colors = {
        success: 'var(--success, #166534)',
        error: 'var(--error, #991b1b)',
        warning: 'var(--warning, #854d0e)',
        info: 'var(--brand, #0b6e6d)'
    };
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.style.borderLeftColor = colors[type] || colors.info;
    n.innerHTML = `
        <i class="fas ${icons[type] || icons.info}" style="color:${colors[type] || colors.info};font-size:14px;flex-shrink:0"></i>
        <span style="flex:1">${escapeHTML(msg)}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:2px 4px;"><i class="fas fa-times" style="font-size:11px"></i></button>
    `;
    container.appendChild(n);
    if (duration > 0) setTimeout(() => n.remove(), duration);
}

// ========== RENDER FUNCTIONS ==========

export function renderVariantList() {
    const container = document.getElementById('variantList');
    if (!container) return;
    
    const start = (state.view.currentPage - 1) * CONFIG.UI.ITEMS_PER_PAGE;
    const page = state.view.filteredVariants.slice(start, start + CONFIG.UI.ITEMS_PER_PAGE);
    
    document.getElementById('listCount').textContent = state.view.filteredVariants.length.toLocaleString();
    
    if (page.length === 0) {
        container.innerHTML = `
            <div class="list-empty">
                <div class="list-empty-icon"><i class="fas fa-search"></i></div>
                <p>${t('selectVariant')}</p>
                <p style="margin-top:6px; font-size:11px">${t('emptySub')}</p>
            </div>`;
        return;
    }
    
    const q = state.view.searchQuery;
    
    container.innerHTML = page.map(v => {
        const isSelected = state.view.selectedVariant?.id === v.id;
        const cls = getClassClass(v);
        const eti = v.eti_prediction || 'unknown';
        const etiLabel = eti === 'responsive' ? 'ETI ✓' : eti === 'non_responsive' ? 'ETI ✗' : '—';
        const valCount = v.validation_count || 0;
        const isExceptional = v.class_subtype === 'exceptional';
        const hasMissing = selectors.hasMissingData(v);
        
        let nameDisplay = escapeHTML(v.legacy_name || '');
        if (q && q.length >= 2) {
            try {
                const regex = new RegExp(`(${escapeRegExp(q)})`, 'gi');
                nameDisplay = nameDisplay.replace(regex, '<span class="sh">$1</span>');
            } catch (e) {}
        }
        
        const clsColor = {
            ci: 'var(--class-i)', cii: 'var(--class-ii)', ciii: 'var(--class-iii)',
            civ: 'var(--class-iv)', cv: 'var(--class-v)', cvi: 'var(--class-vi)', cx: 'var(--text-tertiary)'
        };
        const clsBg = {
            ci: 'var(--class-i-bg)', cii: 'var(--class-ii-bg)', ciii: 'var(--class-iii-bg)',
            civ: 'var(--class-iv-bg)', cv: 'var(--class-v-bg)', cvi: 'var(--class-vi-bg)', cx: 'var(--surface-alt)'
        };
        
        return `
        <div class="variant-row ${isSelected ? 'selected' : ''}" data-variant-id="${v.id}" data-variant-name="${escapeAttr(v.legacy_name)}">
            <div class="row-accent ${cls}"></div>
            <div class="row-content">
                <div class="row-top">
                    <span class="row-name">${nameDisplay}${isExceptional ? ' <span style="color:var(--class-ii);font-size:9px;">⚡</span>' : ''}</span>
                    ${v.cftr_class ? `<span class="row-class-badge ${cls}">${v.cftr_class}</span>` : ''}
                </div>
                ${v.protein_name ? `<div class="row-protein">${escapeHTML(v.protein_name)}</div>` : '<div class="row-protein" style="opacity:0.4">—</div>'}
                <div class="row-indicators">
                    <span class="eti-indicator ${eti}">
                        <span class="eti-dot"></span>
                        ${etiLabel}
                    </span>
                    ${valCount > 0 ? `<span class="val-badge"><i class="fas fa-check-circle" style="font-size:9px"></i>${valCount}</span>` : ''}
                    ${hasMissing ? `<span class="missing-pip" title="${t('missingData')}"></span>` : ''}
                </div>
            </div>
            <div class="collapsed-icon-row ${cls}" style="background:${clsBg[cls]};color:${clsColor[cls]};font-weight:700;font-size:11px;">
                ${v.cftr_class || '?'}
            </div>
        </div>`;
    }).join('');
    
    updatePagination();
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttr(s) {
    if (!s) return '';
    return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function updatePagination() {
    const total = Math.ceil(state.view.filteredVariants.length / CONFIG.UI.ITEMS_PER_PAGE);
    const ctrl = document.getElementById('listPagination');
    if (!ctrl) return;
    ctrl.style.display = total > 1 ? 'flex' : 'none';
    document.getElementById('currentPage').textContent = state.view.currentPage;
    document.getElementById('totalPages').textContent = total;
    const prev = document.getElementById('prevBtn');
    const next = document.getElementById('nextBtn');
    if (prev) prev.disabled = state.view.currentPage === 1;
    if (next) next.disabled = state.view.currentPage === total;
}

export function renderVariantDetail(variant) {
    const emptyDiv = document.getElementById('detailEmpty');
    const container = document.getElementById('variantDetail');
    
    if (!variant) {
        emptyDiv?.classList.remove('hidden');
        container?.classList.add('hidden');
        return;
    }
    
    emptyDiv?.classList.add('hidden');
    container?.classList.remove('hidden');
    
    const cls = getClassClass(variant);
    const isResponsive = variant.eti_prediction === 'responsive';
    const isNonResponsive = variant.eti_prediction === 'non_responsive';
    const isExceptional = variant.class_subtype === 'exceptional';
    const valCount = variant.validation_count || 0;
    
    const etiCardClass = isResponsive ? 'yes' : isNonResponsive ? 'no' : 'unk';
    const etiIcon = isResponsive ? 'fa-check-circle' : isNonResponsive ? 'fa-times-circle' : 'fa-question-circle';
    const etiLabel = isResponsive ? t('etiResponsiveLabel') : isNonResponsive ? t('etiNonResponsiveLabel') : t('etiUnknownLabel');
    const etiSub = isResponsive ? t('etiResponsiveDesc') : isNonResponsive ? t('etiNonResponsiveDesc') : t('etiUnknownDesc');
    
    const evidenceLinks = variant.evidence_links || [];
    const evidenceHTML = evidenceLinks.length === 0
        ? `<div class="evidence-empty"><i class="fas fa-link" style="margin-bottom:6px;display:block;font-size:18px;opacity:0.3"></i>${t('noEvidence')}</div>`
        : evidenceLinks.slice(0, 3).map(link => renderEvidenceLink(link)).join('');
    
    const classDesc = {
        I: t('classIDesc'),
        II: t('classIIDesc'),
        III: t('classIIIDesc'),
        IV: t('classIVDesc'),
        V: t('classVDesc'),
        VI: t('classVIDesc')
    };
    
    container.innerHTML = `
        <!-- DETAIL HEADER -->
        <div class="detail-header">
            <div class="detail-class-block ${cls}">
                <span class="class-roman">${variant.cftr_class || '?'}</span>
                <span class="class-label">${t('class')}</span>
            </div>
            <div class="detail-names">
                <div class="detail-legacy">${escapeHTML(variant.legacy_name || '—')}</div>
                <div class="detail-protein">${escapeHTML(variant.protein_name || t('notSpecified'))}</div>
                <div class="detail-tags">
                    ${variant.cftr_class ? `<span class="detail-tag tag-neutral"><i class="fas fa-dna" style="font-size:9px"></i> ${escapeHTML(classDesc[variant.cftr_class] || 'Class ' + variant.cftr_class)}</span>` : ''}
                    ${isResponsive ? `<span class="detail-tag tag-eti-yes"><i class="fas fa-check" style="font-size:9px"></i> ${t('etiResponsiveLabel')}</span>` : ''}
                    ${isNonResponsive ? `<span class="detail-tag tag-eti-no"><i class="fas fa-times" style="font-size:9px"></i> ${t('etiNonResponsiveLabel')}</span>` : ''}
                    ${isExceptional ? `<span class="detail-tag tag-exceptional">⚡ ${t('exceptional')}</span>` : ''}
                    ${variant.final_determination === 'CF-causing' ? `<span class="detail-tag tag-cf"><i class="fas fa-exclamation-triangle" style="font-size:9px"></i> ${variant.final_determination}</span>` : ''}
                    ${valCount > 0 ? `<span class="detail-tag tag-validated"><i class="fas fa-check-circle" style="font-size:9px"></i> ${valCount} ${t('validationHistory')}</span>` : ''}
                </div>
            </div>
            <div class="detail-meta">
                <div class="detail-actions">
                    <button onclick="window.handleValidate('${escapeAttr(variant.legacy_name)}', ${variant.id})" class="btn btn-secondary btn-sm">
                        <i class="fas fa-check-circle"></i> ${t('validate')}
                    </button>
                    <button onclick="window.handleEdit('${escapeAttr(variant.legacy_name)}')" class="btn btn-secondary btn-sm">
                        <i class="fas fa-pencil-alt"></i> ${t('edit')}
                    </button>
                    <button onclick="window.handleDelete('${escapeAttr(variant.legacy_name)}', ${variant.id})" class="btn btn-ghost btn-sm">
                        <i class="fas fa-trash-alt" style="color:var(--error)"></i>
                    </button>
                </div>
                ${variant.updated_at ? `<span style="font-size:10px;color:var(--text-tertiary)">${t('updated')} ${formatDate(variant.updated_at)}</span>` : ''}
            </div>
        </div>
        
        <!-- NOMENCLATURE ROW -->
        <div class="nomenclature-row">
            <div class="nomen-card" onclick="window.handleEditField('${escapeAttr(variant.legacy_name)}', 'legacy_name', '${escapeAttr(variant.legacy_name || '')}')" style="cursor:pointer">
                <div class="nomen-card-label">${t('legacyName')}</div>
                <div class="nomen-card-value">${escapeHTML(variant.legacy_name || t('notSpecified'))}</div>
            </div>
            <div class="nomen-card" onclick="window.handleEditField('${escapeAttr(variant.legacy_name)}', 'protein_name', '${escapeAttr(variant.protein_name || '')}')" style="cursor:pointer">
                <div class="nomen-card-label">${t('proteinNotation')}</div>
                <div class="nomen-card-value ${!variant.protein_name ? 'field-value missing' : ''}">${escapeHTML(variant.protein_name || t('notSpecified'))}</div>
            </div>
            <div class="nomen-card" onclick="window.handleEditField('${escapeAttr(variant.legacy_name)}', 'cdna_name', '${escapeAttr(variant.cdna_name || '')}')" style="cursor:pointer">
                <div class="nomen-card-label">${t('cdnaNotation')}</div>
                <div class="nomen-card-value ${!variant.cdna_name ? 'field-value missing' : ''}">${escapeHTML(variant.cdna_name || t('notSpecified'))}</div>
            </div>
        </div>
        
        <!-- MAIN GRID -->
        <div class="detail-grid">
            <!-- Clinical Classification -->
            <div class="detail-section">
                <div class="section-header">
                    <div class="section-header-icon" style="background:var(--class-i-bg);color:var(--class-i)"><i class="fas fa-stethoscope"></i></div>
                    <span class="section-title">${t('clinicalClassification')}</span>
                    <button class="section-action" onclick="window.handleEditField('${escapeAttr(variant.legacy_name)}', 'cftr_class', '${escapeAttr(variant.cftr_class || '')}')">${t('edit')}</button>
                </div>
                <div class="section-body">
                    <div class="field-grid">
                        ${dataField(t('determination'), variant.final_determination, 'final_determination', variant)}
                        ${dataField(t('class'), variant.cftr_class ? t('class') + ' ' + variant.cftr_class : null, 'cftr_class', variant)}
                        ${dataField(t('subtype'), variant.class_subtype, 'class_subtype', variant)}
                        ${dataField(t('confidence'), variant.class_confidence, 'class_confidence', variant)}
                    </div>
                </div>
            </div>
            
            <!-- Therapeutic Prediction -->
            <div class="detail-section">
                <div class="section-header">
                    <div class="section-header-icon" style="background:var(--brand-light);color:var(--brand)"><i class="fas fa-prescription-bottle-alt"></i></div>
                    <span class="section-title">${t('therapeuticPrediction')}</span>
                    <button class="section-action" onclick="window.handleEditField('${escapeAttr(variant.legacy_name)}', 'eti_prediction', '${escapeAttr(variant.eti_prediction || '')}')">${t('edit')}</button>
                </div>
                <div class="section-body">
                    <div class="eti-card ${etiCardClass}">
                        <div class="eti-icon"><i class="fas ${etiIcon}"></i></div>
                        <div>
                            <div class="eti-label">${etiLabel}</div>
                            <div class="eti-sub">${etiSub}</div>
                        </div>
                    </div>
                    <div class="field-grid">
                        ${dataField(t('evidenceLevel'), variant.eti_evidence_level, 'eti_evidence_level', variant)}
                        ${dataField(t('recommendation'), variant.eti_recommendation, 'eti_recommendation', variant)}
                    </div>
                </div>
            </div>
        </div>
        
        <!-- EVIDENCE + VALIDATION GRID -->
        <div class="detail-grid">
            <!-- Evidence Chain -->
            <div class="detail-section">
                <div class="section-header">
                    <div class="section-header-icon" style="background:var(--class-v-bg);color:var(--class-v)"><i class="fas fa-link"></i></div>
                    <span class="section-title">${t('evidenceChain')}</span>
                    <span style="font-size:11px;color:var(--text-tertiary);margin-right:4px;">${evidenceLinks.length} ${t('evidenceSources')}</span>
                    <button class="section-action" onclick="window.handleViewAllEvidence(${variant.id})">${t('viewAll')}</button>
                    <button class="section-action" onclick="window.handleAddEvidence('${escapeAttr(variant.legacy_name)}', ${variant.id})">+ ${t('add')}</button>
                </div>
                <div class="section-body">
                    <div class="evidence-list">${evidenceHTML}</div>
                </div>
            </div>
            
            <!-- Clinical Validation -->
            <div class="detail-section">
                <div class="section-header">
                    <div class="section-header-icon" style="background:var(--brand-light);color:var(--brand)"><i class="fas fa-shield-alt"></i></div>
                    <span class="section-title">${t('clinicalValidation')}</span>
                    <span style="font-size:11px;color:var(--text-tertiary);margin-right:4px;">${valCount}</span>
                    <button class="section-action" onclick="window.handleValidate('${escapeAttr(variant.legacy_name)}', ${variant.id})">+ ${t('add')}</button>
                </div>
                <div class="section-body">
                    ${valCount > 0 ? `
                    <div class="validation-summary">
                        <div class="val-icon"><i class="fas fa-check-circle"></i></div>
                        <div class="val-info">
                            <div class="val-count">${valCount}</div>
                            <div class="val-sub">
                                ${variant.last_validator_name ? `${t('lastValidated')} ${escapeHTML(variant.last_validator_name)}` : t('validated')}
                                ${variant.last_validator_role ? `<span class="val-entry-role">${escapeHTML(variant.last_validator_role)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div style="text-align:center;padding:16px 0;color:var(--text-tertiary)">
                        <i class="fas fa-shield-alt" style="font-size:24px;opacity:0.2;margin-bottom:8px;display:block"></i>
                        <p style="font-size:12px">${t('noValidations')}</p>
                        <button onclick="window.handleValidate('${escapeAttr(variant.legacy_name)}', ${variant.id})" class="btn btn-primary btn-sm" style="margin-top:10px">
                            <i class="fas fa-check-circle"></i> ${t('firstToValidate')}
                        </button>
                    </div>
                    `}
                    <div class="divider"></div>
                    <div class="val-history" id="valHistory-${variant.id}">
                        <div style="text-align:center;padding:8px;font-size:11px;color:var(--text-tertiary)">
                            <i class="fas fa-spinner fa-spin"></i> ${t('loadingVariants')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Load validation history
    setTimeout(() => loadValidationHistory(variant.id), 100);
}

function dataField(label, value, field, variant) {
    const isMissing = !value || value === '' || value === 'null';
    const display = isMissing ? t('notSpecified') : escapeHTML(String(value));
    const escaped = value ? escapeAttr(String(value)) : '';
    return `
    <div class="data-field">
        <div class="field-label">${label}${isMissing ? '<span class="missing-dot" title="' + t('missingData') + '"></span>' : ''}</div>
        <div class="field-value ${isMissing ? 'missing' : ''}">${display}</div>
        <button class="field-edit" onclick="window.handleEditField('${escapeAttr(variant.legacy_name)}','${field}','${escaped}')" title="${t('edit')}">
            <i class="fas fa-pencil-alt"></i>
        </button>
    </div>`;
}

function renderEvidenceLink(link) {
    const iconMap = { pubmed: 'fa-book-open', cftr2: 'fa-dna', clinvar: 'fa-hospital', other: 'fa-link' };
    const icon = iconMap[link.type?.toLowerCase()] || 'fa-link';
    const typeClass = link.type?.toLowerCase() || 'other';
    
    return `
    <a href="${escapeHTML(link.url || '#')}" target="_blank" class="evidence-item" onclick="event.stopPropagation()">
        <div class="evidence-type-icon ${typeClass}"><i class="fas ${icon}"></i></div>
        <div class="evidence-info">
            <div class="evidence-title">${escapeHTML(link.title || 'Untitled')}</div>
            <div class="evidence-source">${escapeHTML(link.source || link.type || 'Source')}</div>
        </div>
        <i class="fas fa-external-link-alt evidence-arrow"></i>
    </a>`;
}

async function loadValidationHistory(variantId) {
    const container = document.getElementById(`valHistory-${variantId}`);
    if (!container) return;
    
    try {
        const validations = await actions.getValidationHistory(variantId);
        
        if (validations.length === 0) {
            container.innerHTML = `<div style="text-align:center;font-size:11px;color:var(--text-tertiary);padding:8px;">${t('noValidations')}</div>`;
            return;
        }
        
        container.innerHTML = validations.slice(0, 5).map((v, i) => {
            const initials = (v.clinician_name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            return `
            <div class="val-entry">
                <div class="val-avatar">${initials}</div>
                <div style="flex:1;min-width:0">
                    <div class="val-entry-name">
                        ${escapeHTML(v.clinician_name)}
                        ${v.clinician_role ? `<span class="val-entry-role">${escapeHTML(v.clinician_role)}</span>` : ''}
                        ${i === 0 ? `<span style="font-size:9px;color:var(--text-tertiary);margin-left:4px">${t('latest')}</span>` : ''}
                    </div>
                    <div class="val-entry-date">${formatDate(v.created_at)}</div>
                    ${v.notes ? `<div class="val-entry-note">"${escapeHTML(v.notes)}"</div>` : ''}
                </div>
            </div>`;
        }).join('');
        
        if (validations.length > 5) {
            container.innerHTML += `<div style="text-align:center;font-size:11px;color:var(--text-tertiary);padding:6px;">${validations.length - 5} more…</div>`;
        }
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;font-size:11px;color:var(--error);padding:8px;">${t('connectionFailed')}</div>`;
    }
}

// ========== HEADER STATS ==========

export function updateHeaderStats() {
    const s = state.stats;
    const missing = state.variants.filter(v => selectors.hasMissingData(v)).length;
    
    document.getElementById('hstatTotal').textContent = s.total.toLocaleString();
    document.getElementById('hstatResponsive').textContent = s.responsive.toLocaleString();
    document.getElementById('hstatMissing').textContent = missing.toLocaleString();
    
    document.getElementById('chipAll').textContent = s.total.toLocaleString();
    document.getElementById('chipResponsive').textContent = s.responsive.toLocaleString();
    document.getElementById('chipExceptional').textContent = s.exceptional.toLocaleString();
    document.getElementById('chipComplete').textContent = s.complete.toLocaleString();
    document.getElementById('chipMissing').textContent = missing.toLocaleString();
}

// ========== MODAL FUNCTIONS (to be implemented) ==========

export function showValidationModal(variantName, variantId) {
    // Will implement modal rendering
    console.log('Show validation modal for', variantName, variantId);
}

export function showEditFieldModal(variantName, field, currentValue) {
    // Will implement modal rendering
    console.log('Show edit modal for', variantName, field, currentValue);
}

export function showDeleteModal(variantName, variantId) {
    // Will implement modal rendering
    console.log('Show delete modal for', variantName, variantId);
}

export function showAddEvidenceModal(variantName, variantId) {
    // Will implement modal rendering
    console.log('Show add evidence modal for', variantName, variantId);
}

export function showAllEvidenceModal(variantId) {
    // Will implement modal rendering
    console.log('Show all evidence for', variantId);
}

export function showImportModal() {
    // Will implement modal rendering
    console.log('Show import modal');
}

export function showDashboard() {
    // Will implement dashboard rendering
    console.log('Show dashboard');
}

// ========== EXPORT ==========

export function exportReport() {
    const headers = [
        t('legacyName'), t('proteinNotation'), t('cdnaNotation'),
        t('determination'), t('class'), t('etiPrediction'),
        t('subtype'), t('confidence'), t('validationHistory')
    ];
    
    const rows = state.variants.map(v => [
        v.legacy_name, v.protein_name, v.cdna_name, v.final_determination,
        v.cftr_class, v.eti_prediction, v.class_subtype, v.class_confidence,
        v.validation_count || 0
    ]);
    
    generateCSV(headers, rows, `helix-export-${getCurrentDate()}.csv`);
    showNotification(t('exportComplete'), 'success');
}

function generateCSV(headers, rows, filename) {
    const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function getCurrentDate() {
    return new Date().toISOString().split('T')[0];
}

// ========== GLOBAL EXPORTS FOR INLINE HANDLERS ==========

window.refreshUI = () => {
    renderVariantList();
    if (state.view.selectedVariant) {
        renderVariantDetail(state.view.selectedVariant);
    }
    updateHeaderStats();
};

window.handleSelectVariant = (variantName) => {
    const variant = state.variantsByLegacyName.get(variantName);
    if (variant) {
        actions.selectVariant(variant);
        renderVariantList();
        renderVariantDetail(variant);
    }
};

window.handleValidate = (variantName, variantId) => {
    showValidationModal(variantName, variantId);
};

window.handleEdit = (variantName) => {
    // Placeholder
};

window.handleDelete = (variantName, variantId) => {
    showDeleteModal(variantName, variantId);
};

window.handleEditField = (variantName, field, currentValue) => {
    showEditFieldModal(variantName, field, currentValue);
};

window.handleAddEvidence = (variantName, variantId) => {
    showAddEvidenceModal(variantName, variantId);
};

window.handleViewAllEvidence = (variantId) => {
    showAllEvidenceModal(variantId);
};

// Export for module usage
export const ui = {
    renderVariantList,
    renderVariantDetail,
    updateHeaderStats,
    showValidationModal,
    showEditFieldModal,
    showDeleteModal,
    showAddEvidenceModal,
    showAllEvidenceModal,
    showImportModal,
    showDashboard,
    exportReport
};
