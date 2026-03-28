// ============================================================
// Δ HELIX v3 — STORE (State + Actions + Selectors)
// ============================================================

import { CONFIG, TRANSLATIONS } from './config.js';
import { api } from './api.js';

// ========== STATE ==========

export const state = {
    // Language
    currentLang: 'en',
    
    // Data
    variants: [],
    variantsById: new Map(),
    variantsByLegacyName: new Map(),
    existingRoles: [],
    
    // UI State
    view: {
        filteredVariants: [],
        selectedVariant: null,
        dataViewMode: 'all',      // 'all', 'responsive', 'exceptional', 'complete'
        activeFilter: null,        // 'missing'
        classFilter: 'all',
        currentPage: 1,
        searchQuery: '',
        sortAsc: true
    },
    
    // Statistics (cached)
    stats: {
        total: 0,
        complete: 0,
        clinical: 0,
        classI: 0,
        classII: 0,
        classIII: 0,
        classIV: 0,
        classV: 0,
        classVI: 0,
        exceptional: 0,
        responsive: 0,
        nonResponsive: 0,
        unknown: 0,
        validated: 0
    },
    
    // Search index
    searchIndex: {
        termMap: new Map()
    }
};

// ========== TRANSLATION HELPER ==========

export function t(key) {
    const translation = TRANSLATIONS[state.currentLang][key];
    if (!translation) {
        console.warn(`Missing translation for: ${key}`);
        return key;
    }
    return translation;
}

// ========== SELECTORS ==========

export const selectors = {
    getFilteredVariants() {
        let filtered = [...state.variants];
        
        // Apply search
        if (state.view.searchQuery.length >= CONFIG.UI.MIN_SEARCH_CHARS) {
            filtered = this.searchVariants(state.view.searchQuery);
        }
        
        // Apply view mode
        switch (state.view.dataViewMode) {
            case 'responsive':
                filtered = filtered.filter(v => v.eti_prediction === 'responsive');
                break;
            case 'exceptional':
                filtered = filtered.filter(v => v.class_subtype === 'exceptional');
                break;
            case 'complete':
                filtered = filtered.filter(v => v.data_status === 'complete_clinical');
                break;
        }
        
        // Apply missing filter
        if (state.view.activeFilter === 'missing') {
            filtered = filtered.filter(v => this.hasMissingData(v));
        }
        
        // Apply class filter
        if (state.view.classFilter !== 'all') {
            filtered = filtered.filter(v => v.cftr_class === state.view.classFilter);
        }
        
        // Apply sort
        if (state.view.sortAsc) {
            filtered.sort((a, b) => (a.legacy_name || '').localeCompare(b.legacy_name || ''));
        } else {
            filtered.sort((a, b) => (b.legacy_name || '').localeCompare(a.legacy_name || ''));
        }
        
        return filtered;
    },
    
    searchVariants(query) {
        const q = query.toLowerCase().trim();
        const matchedIds = new Set();
        const scores = new Map();
        
        const terms = [q, q.replace(/^p\./, ''), q.replace(/^c\./, '')];
        terms.forEach(term => {
            if (term && term.length >= 2 && state.searchIndex.termMap.has(term)) {
                state.searchIndex.termMap.get(term).forEach(id => {
                    matchedIds.add(id);
                    scores.set(id, (scores.get(id) || 0) + (term === q ? 100 : 20));
                });
            }
        });
        
        return Array.from(matchedIds)
            .map(id => ({ v: state.variantsById.get(id), s: scores.get(id) || 0 }))
            .sort((a, b) => b.s - a.s)
            .map(r => r.v);
    },
    
    hasMissingData(variant) {
        return !variant.cftr_class || !variant.eti_prediction || !variant.final_determination;
    },
    
    calculateStats() {
        const v = state.variants;
        return {
            total: v.length,
            complete: v.filter(x => x.data_status === 'complete_clinical').length,
            clinical: v.filter(x => x.data_status === 'complete_clinical' || x.data_status === 'partial_clinical').length,
            classI: v.filter(x => x.cftr_class === 'I').length,
            classII: v.filter(x => x.cftr_class === 'II').length,
            classIII: v.filter(x => x.cftr_class === 'III').length,
            classIV: v.filter(x => x.cftr_class === 'IV').length,
            classV: v.filter(x => x.cftr_class === 'V').length,
            classVI: v.filter(x => x.cftr_class === 'VI').length,
            exceptional: v.filter(x => x.class_subtype === 'exceptional').length,
            responsive: v.filter(x => x.eti_prediction === 'responsive').length,
            nonResponsive: v.filter(x => x.eti_prediction === 'non_responsive').length,
            unknown: v.filter(x => !x.eti_prediction || x.eti_prediction === 'unknown').length,
            validated: v.filter(x => (x.validation_count || 0) > 0).length
        };
    }
};

// ========== ACTIONS ==========

export const actions = {
    // Language
    setLanguage(lang) {
        if (lang !== 'en' && lang !== 'es') return;
        state.currentLang = lang;
        document.documentElement.lang = lang === 'en' ? 'en' : 'es';
        
        // Update all data-i18n elements
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (el.hasAttribute('data-i18n-placeholder')) {
                    el.placeholder = t(key);
                }
            } else {
                el.textContent = t(key);
            }
        });
        
        // Re-render UI
        this.refreshUI();
    },
    
    toggleLanguage() {
        const newLang = state.currentLang === 'en' ? 'es' : 'en';
        this.setLanguage(newLang);
    },
    
    // Data Loading
    async loadVariants() {
        try {
            const data = await api.getVariants();
            state.variants = data;
            state.variantsById = new Map(state.variants.map(v => [v.id, v]));
            state.variantsByLegacyName = new Map(state.variants.map(v => [v.legacy_name, v]));
            
            this.buildSearchIndex();
            state.stats = selectors.calculateStats();
            
            state.view.filteredVariants = selectors.getFilteredVariants();
            state.view.currentPage = 1;
            
            await this.loadExistingRoles();
            
            return true;
        } catch (err) {
            console.error('Failed to load variants:', err);
            throw err;
        }
    },
    
    buildSearchIndex() {
        const termMap = new Map();
        
        state.variants.forEach(v => {
            const terms = new Set();
            const add = (s) => { if (s && s.trim().length >= 2) terms.add(s.toLowerCase().trim()); };
            
            add(v.legacy_name);
            if (v.protein_name) add(v.protein_name);
            if (v.cdna_name) add(v.cdna_name);
            if (v.cftr_class) add('class' + v.cftr_class);
            if (v.eti_prediction === 'responsive') { add('responsive'); add('eti'); }
            if (v.class_subtype === 'exceptional') add('exceptional');
            if (v.final_determination) add(v.final_determination);
            
            terms.forEach(term => {
                if (!termMap.has(term)) termMap.set(term, new Set());
                termMap.get(term).add(v.id);
            });
        });
        
        state.searchIndex.termMap = termMap;
    },
    
    async loadExistingRoles() {
        const roles = await api.loadExistingRoles();
        state.existingRoles = roles;
    },
    
    // CRUD Actions
    async createVariant(data) {
        const newVariant = await api.createVariant(data);
        state.variants.push(newVariant);
        state.variantsById.set(newVariant.id, newVariant);
        state.variantsByLegacyName.set(newVariant.legacy_name, newVariant);
        
        this.buildSearchIndex();
        state.stats = selectors.calculateStats();
        this.applyFilters();
        
        return newVariant;
    },
    
    async updateVariant(id, updates) {
        await api.updateVariant(id, updates);
        
        const index = state.variants.findIndex(v => v.id === id);
        if (index !== -1) {
            state.variants[index] = { ...state.variants[index], ...updates };
            state.variantsById.set(id, state.variants[index]);
            state.variantsByLegacyName.set(state.variants[index].legacy_name, state.variants[index]);
        }
        
        this.buildSearchIndex();
        state.stats = selectors.calculateStats();
        
        if (state.view.selectedVariant?.id === id) {
            state.view.selectedVariant = state.variantsById.get(id);
        }
        
        this.applyFilters();
    },
    
    async deleteVariant(id, legacyName) {
        await api.deleteVariant(id);
        
        state.variants = state.variants.filter(v => v.id !== id);
        state.variantsById.delete(id);
        state.variantsByLegacyName.delete(legacyName);
        
        this.buildSearchIndex();
        state.stats = selectors.calculateStats();
        
        if (state.view.selectedVariant?.id === id) {
            state.view.selectedVariant = null;
        }
        
        this.applyFilters();
    },
    
    // Validation Actions
    async addValidation(variantId, data) {
        await api.addValidation(variantId, data);
        
        const variant = state.variantsById.get(variantId);
        if (variant) {
            variant.validation_count = (variant.validation_count || 0) + 1;
            variant.last_validator_name = data.clinician_name;
            variant.last_validator_role = data.clinician_role;
            variant.last_validated_at = new Date().toISOString();
        }
        
        state.stats = selectors.calculateStats();
        
        if (state.view.selectedVariant?.id === variantId) {
            state.view.selectedVariant = variant;
        }
        
        this.applyFilters();
    },
    
    async getValidationHistory(variantId) {
        return api.getValidationHistory(variantId);
    },
    
    // Evidence Actions
    async addEvidenceLink(variantId, data) {
        const newLink = await api.addEvidenceLink(variantId, data);
        
        const variant = state.variantsById.get(variantId);
        if (variant) {
            if (!variant.evidence_links) variant.evidence_links = [];
            variant.evidence_links.push(newLink);
        }
        
        if (state.view.selectedVariant?.id === variantId) {
            state.view.selectedVariant = variant;
        }
        
        return newLink;
    },
    
    // UI Actions
    setDataViewMode(mode) {
        state.view.dataViewMode = mode;
        state.view.activeFilter = null;
        this.applyFilters();
    },
    
    setMissingFilter() {
        state.view.activeFilter = 'missing';
        state.view.dataViewMode = 'all';
        this.applyFilters();
    },
    
    setClassFilter(cls) {
        state.view.classFilter = cls;
        this.applyFilters();
    },
    
    setSearchQuery(query) {
        state.view.searchQuery = query;
        this.applyFilters();
    },
    
    toggleSort() {
        state.view.sortAsc = !state.view.sortAsc;
        this.applyFilters();
    },
    
    setCurrentPage(page) {
        state.view.currentPage = page;
    },
    
    selectVariant(variant) {
        state.view.selectedVariant = variant;
    },
    
    applyFilters() {
        state.view.filteredVariants = selectors.getFilteredVariants();
        state.view.currentPage = 1;
    },
    
    refreshUI() {
        // This will be implemented in ui.js
        if (window.refreshUI) window.refreshUI();
    }
};
