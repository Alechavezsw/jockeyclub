import React, { useMemo, useState } from 'react';
import { Search, Filter, Plus, Check, ChevronDown, ChevronUp, Trash2, Users, UserPlus, X, CreditCard, Camera, FileDown } from 'lucide-react';
import { afterCollectDues, duesAmountForHousehold, duesAmountForTier } from '../../domain/members/dues';
import { exportMembersPdf } from '../../domain/members/exportMembersPdf';
import { DISCIPLINE_OPTIONS } from '../../domain/sports/disciplines';
import VirtualCard from '../VirtualCard';
import CollectDuesModal from './CollectDuesModal';

const EMPTY_MEMBER_FORM = {
  name: '',
  photo: '',
  documentType: 'DNI',
  documentNumber: '',
  birthDate: '',
  gender: '',
  maritalStatus: '',
  nationality: 'Argentina',
  email: '',
  phone: '+549264',
  phoneAlt: '',
  address: '',
  city: 'San Juan',
  province: 'San Juan',
  postalCode: '',
  tier: 'gold',
  status: 'active',
  joinDate: new Date().toISOString().slice(0, 10),
  nextDueDate: '',
  paymentMethod: 'transferencia',
  billingName: '',
  cuitCuil: '',
  taxCondition: 'consumidor_final',
  disciplines: [],
  emergencyContact: '',
  emergencyPhone: '',
  notes: '',
  chargeFirstDues: true,
  familyGroup: [],
};

const EMPTY_FAMILY_MEMBER = {
  name: '',
  photo: '',
  relationship: 'Cónyuge',
  documentNumber: '',
  birthDate: '',
  tier: 'gold',
  disciplines: [],
};

/** Lee y comprime una foto a data URL (máx. ~360px) para ficha / credencial. */
function readPhotoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Seleccione una imagen válida.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagen inválida.'));
      img.onload = () => {
        const max = 360;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function PhotoPicker({ value, onChange, label = 'Foto', size = 88 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          border: '1px solid var(--border-glass)',
          background: 'rgba(255,255,255,0.03)',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value ? (
          <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Camera size={22} color="var(--text-muted)" />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="form-label" style={{ margin: 0 }}>{label}</span>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content' }}>
          <Camera size={13} /> {value ? 'Cambiar foto' : 'Subir foto'}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                onChange(await readPhotoFile(file));
              } catch {
                /* ignore invalid */
              }
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onChange('')}
            style={{ width: 'fit-content', color: '#f87171' }}
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}

const RELATIONSHIP_OPTIONS = [
  'Cónyuge', 'Hijo/a', 'Padre/Madre', 'Hermano/a', 'Nieto/a', 'Otro',
];

/** Gestión de socios titulares y adherentes familiares. */
export default function MembersTab({ members, setMembers, addJournalEntry, formatCurrency, onOpenProfile }) {
  const [tierFilter, setTierFilter] = useState('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_MEMBER_FORM);
  const [formError, setFormError] = useState('');
  const [expandedMemberId, setExpandedMemberId] = useState(null);
  const [cardMember, setCardMember] = useState(null);
  const [collectMember, setCollectMember] = useState(null);

  const [showAddAdherentId, setShowAddAdherentId] = useState(null);
  const [adhName, setAdhName] = useState('');
  const [adhPhoto, setAdhPhoto] = useState('');
  const [adhRelationship, setAdhRelationship] = useState('Hijo/a');
  const [adhTier, setAdhTier] = useState('gold');
  const [adhDisciplines, setAdhDisciplines] = useState([]);

  const duesPreview = useMemo(
    () => duesAmountForHousehold(form.tier, form.familyGroup),
    [form.tier, form.familyGroup]
  );
  const duesBreakdown = useMemo(() => {
    const titular = duesAmountForTier(form.tier);
    const family = form.familyGroup.map((row, i) => ({
      key: row.id || i,
      name: row.name?.trim() || `Familiar ${i + 1}`,
      amount: duesAmountForTier(row.tier || form.tier),
    }));
    return { titular, family, total: titular + family.reduce((s, f) => s + f.amount, 0) };
  }, [form.tier, form.familyGroup]);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleDiscipline = (discipline) => {
    setForm((prev) => {
      const has = prev.disciplines.includes(discipline);
      return {
        ...prev,
        disciplines: has
          ? prev.disciplines.filter((d) => d !== discipline)
          : [...prev.disciplines, discipline],
      };
    });
  };

  const toggleFamilyDiscipline = (index, discipline) => {
    setForm((prev) => ({
      ...prev,
      familyGroup: prev.familyGroup.map((row, i) => {
        if (i !== index) return row;
        const current = row.disciplines || [];
        const has = current.includes(discipline);
        return {
          ...row,
          disciplines: has
            ? current.filter((d) => d !== discipline)
            : [...current, discipline],
        };
      }),
    }));
  };

  const addFamilyMember = () => {
    setForm((prev) => ({
      ...prev,
      familyGroup: [
        ...prev.familyGroup,
        {
          ...EMPTY_FAMILY_MEMBER,
          tier: prev.tier,
          disciplines: [],
          id: `tmp-${Date.now()}`,
        },
      ],
    }));
  };

  const updateFamilyMember = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      familyGroup: prev.familyGroup.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      ),
    }));
  };

  const removeFamilyMember = (index) => {
    setForm((prev) => ({
      ...prev,
      familyGroup: prev.familyGroup.filter((_, i) => i !== index),
    }));
  };

  const resetForm = () => {
    setForm({ ...EMPTY_MEMBER_FORM, familyGroup: [], disciplines: [], photo: '' });
    setFormError('');
  };

  const filteredMembers = members.filter(m => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      m.name.toLowerCase().includes(q) ||
      m.memberId.includes(searchQuery) ||
      (m.email || '').toLowerCase().includes(q) ||
      (m.documentNumber || '').includes(searchQuery) ||
      (m.phone || '').includes(searchQuery);
    const matchesTier = tierFilter === 'todos' || m.tier.toLowerCase() === tierFilter.toLowerCase();
    return matchesSearch && matchesTier;
  });

  const handleAddMember = (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) {
      setFormError('El nombre completo es obligatorio.');
      return;
    }
    if (!form.phone.trim()) {
      setFormError('El teléfono WhatsApp es obligatorio.');
      return;
    }
    if (!form.disciplines.length) {
      setFormError('Seleccione al menos una disciplina (requisito de alta).');
      return;
    }
    if (form.documentNumber.trim() && members.some((m) => m.documentNumber === form.documentNumber.trim())) {
      setFormError('Ya existe un socio con ese documento.');
      return;
    }

    const incompleteFamily = form.familyGroup.some((f) => !f.name?.trim());
    if (incompleteFamily) {
      setFormError('Complete el nombre de todos los integrantes del grupo familiar, o elimínelos.');
      return;
    }
    const familyWithoutDiscipline = form.familyGroup.some((f) => !(f.disciplines || []).length);
    if (familyWithoutDiscipline) {
      setFormError('Cada integrante del grupo familiar debe tener al menos una disciplina.');
      return;
    }

    const randomNum = Math.floor(1000000000000000 + Math.random() * 9000000000000000);
    const firstDues = form.chargeFirstDues
      ? duesAmountForHousehold(form.tier, form.familyGroup)
      : 0;
    const joinDate = form.joinDate || new Date().toISOString().slice(0, 10);
    const nextDue = form.nextDueDate || (() => {
      const d = new Date(`${joinDate}T12:00:00`);
      d.setMonth(d.getMonth() + 1);
      return d.toISOString().slice(0, 10);
    })();

    const adherents = form.familyGroup.map((f, idx) => ({
      id: `adh-${Date.now()}-${idx}`,
      name: f.name.trim(),
      photo: f.photo || '',
      relationship: f.relationship || 'Otro',
      documentNumber: (f.documentNumber || '').trim(),
      birthDate: f.birthDate || null,
      tier: f.tier || form.tier,
      disciplines: f.disciplines || [],
      outstandingBalance: 0,
      status: 'active',
    }));

    const newMember = {
      name: form.name.trim(),
      photo: form.photo || '',
      memberId: randomNum.toString(),
      documentType: form.documentType,
      documentNumber: form.documentNumber.trim(),
      birthDate: form.birthDate || null,
      gender: form.gender || null,
      maritalStatus: form.maritalStatus || null,
      nationality: form.nationality.trim() || 'Argentina',
      email: form.email.trim(),
      phone: form.phone.trim(),
      phoneAlt: form.phoneAlt.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      province: form.province.trim(),
      postalCode: form.postalCode.trim(),
      tier: form.tier,
      status: form.status,
      joinDate,
      nextDueDate: nextDue,
      overdueSince: firstDues > 0 ? joinDate : null,
      paymentMethod: form.paymentMethod,
      billingName: form.billingName.trim() || form.name.trim(),
      cuitCuil: form.cuitCuil.trim(),
      taxCondition: form.taxCondition,
      disciplines: form.disciplines,
      emergencyContact: form.emergencyContact.trim(),
      emergencyPhone: form.emergencyPhone.trim(),
      notes: form.notes.trim(),
      outstandingBalance: firstDues,
      yearsActive: 1,
      adherents,
    };

    setMembers([newMember, ...members]);
    resetForm();
    setShowAddForm(false);
  };

  const handleConfirmCollect = ({ method, bankName, journalAccount, receiptName, amount }) => {
    const member = collectMember;
    if (!member || amount <= 0) return;

    const methodLabel =
      method === 'efectivo' ? 'Efectivo'
        : method === 'mercadopago' ? 'Mercado Pago'
          : `Transferencia ${bankName || ''}`.trim();
    const receiptNote = receiptName ? ` · Comp: ${receiptName}` : '';

    addJournalEntry({
      date: new Date().toISOString().split('T')[0],
      description: `Cobro cuota social (${methodLabel}) - Socio: ${member.name} (Cred. ${member.memberId.slice(0, 6)}...)${receiptNote}`,
      lines: [
        { account: journalAccount, type: 'debit', amount },
        { account: 'Cuotas Sociales', type: 'credit', amount },
      ],
      sourceModule: 'cuotas',
    });

    setMembers(members.map((m) => (
      m.memberId === member.memberId ? afterCollectDues(m) : m
    )));
    setCollectMember(null);
  };

  const handleAddAdherent = (memberId) => {
    if (!adhName.trim()) return;
    if (!adhDisciplines.length) return;
    const newAdherent = {
      id: `adh-${Date.now()}`,
      name: adhName.trim(),
      photo: adhPhoto || '',
      relationship: adhRelationship,
      tier: adhTier,
      disciplines: adhDisciplines,
      outstandingBalance: 0,
      status: 'active'
    };

    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: [...(m.adherents || []), newAdherent]
        };
      }
      return m;
    }));

    setAdhName('');
    setAdhPhoto('');
    setAdhDisciplines([]);
    setShowAddAdherentId(null);
  };

  const handleToggleAdherentStatus = (memberId, adherentId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: m.adherents.map(adh => {
            if (adh.id === adherentId) {
              return { ...adh, status: adh.status === 'active' ? 'suspended' : 'active' };
            }
            return adh;
          })
        };
      }
      return m;
    }));
  };

  const handleDeleteAdherent = (memberId, adherentId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: m.adherents.filter(adh => adh.id !== adherentId)
        };
      }
      return m;
    }));
  };

  return (
    <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="admin-filters" style={{ width: '100%' }}>
        {/* Buscador */}
        <div style={{ position: 'relative', minWidth: 0, flex: '1 1 220px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar por nombre, credencial, DNI, email o teléfono..."
            className="form-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.5rem', width: '100%' }}
          />
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Filter size={16} style={{ color: 'var(--text-muted)' }} />
          <div className="filter-group">
            {['todos', 'royal', 'platinum', 'gold'].map(tier => (
              <button
                key={tier}
                onClick={() => setTierFilter(tier)}
                className={`filter-btn ${tierFilter === tier ? 'active' : ''}`}
                style={{ textTransform: 'capitalize' }}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => exportMembersPdf(filteredMembers, {
            formatCurrency,
            filterLabel: tierFilter === 'todos' ? 'Todos' : tierFilter,
          })}
          className="btn btn-secondary"
          style={{ padding: '0.5rem 1.1rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title="Exportar padrón filtrado a PDF"
        >
          <FileDown size={16} /> Exportar PDF
        </button>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn btn-primary"
          style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
        >
          <Plus size={16} /> Registrar Socio
        </button>
      </div>

      {/* Formulario Alta de Socio — ficha completa */}
      {showAddForm && (
        <form
          onSubmit={handleAddMember}
          className="glass-panel fade-in"
          style={{
            padding: '1.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: '1.35rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <h4 className="serif-font" style={{ fontSize: '1.25rem', margin: 0, color: 'var(--text-gold)' }}>
                Alta de socio titular
              </h4>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Complete la ficha institucional y, si corresponde, el grupo familiar. Los campos con * son obligatorios.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { resetForm(); setShowAddForm(false); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <X size={14} /> Cerrar
            </button>
          </div>

          {/* 1. Datos personales */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              1. Datos personales
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div style={{ gridColumn: '1 / -1', marginBottom: '0.25rem' }}>
                <PhotoPicker
                  value={form.photo}
                  onChange={(photo) => updateForm('photo', photo)}
                  label="Foto del titular (credencial)"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label className="form-label">Nombre completo *</label>
                <input className="form-input" required value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="Apellido y nombres" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tipo documento</label>
                <select className="form-input" value={form.documentType} onChange={(e) => updateForm('documentType', e.target.value)}>
                  <option value="DNI">DNI</option>
                  <option value="Pasaporte">Pasaporte</option>
                  <option value="CUIT">CUIT</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">N° documento</label>
                <input className="form-input" value={form.documentNumber} onChange={(e) => updateForm('documentNumber', e.target.value)} placeholder="Sin puntos" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Fecha de nacimiento</label>
                <input type="date" className="form-input" value={form.birthDate} onChange={(e) => updateForm('birthDate', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Género</label>
                <select className="form-input" value={form.gender} onChange={(e) => updateForm('gender', e.target.value)}>
                  <option value="">—</option>
                  <option value="femenino">Femenino</option>
                  <option value="masculino">Masculino</option>
                  <option value="otro">Otro / Prefiere no decir</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Estado civil</label>
                <select className="form-input" value={form.maritalStatus} onChange={(e) => updateForm('maritalStatus', e.target.value)}>
                  <option value="">—</option>
                  <option value="soltero">Soltero/a</option>
                  <option value="casado">Casado/a</option>
                  <option value="union">Unión convivencial</option>
                  <option value="divorciado">Divorciado/a</option>
                  <option value="viudo">Viudo/a</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Nacionalidad</label>
                <input className="form-input" value={form.nationality} onChange={(e) => updateForm('nationality', e.target.value)} />
              </div>
            </div>
          </section>

          {/* 2. Contacto */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              2. Contacto y domicilio
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Email</label>
                <input type="email" className="form-input" value={form.email} onChange={(e) => updateForm('email', e.target.value)} placeholder="correo@ejemplo.com" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Celular WhatsApp *</label>
                <input className="form-input" required value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} placeholder="+549264..." />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Teléfono alternativo</label>
                <input className="form-input" value={form.phoneAlt} onChange={(e) => updateForm('phoneAlt', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label className="form-label">Domicilio</label>
                <input className="form-input" value={form.address} onChange={(e) => updateForm('address', e.target.value)} placeholder="Calle, número, barrio" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Localidad</label>
                <input className="form-input" value={form.city} onChange={(e) => updateForm('city', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Provincia</label>
                <input className="form-input" value={form.province} onChange={(e) => updateForm('province', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Código postal</label>
                <input className="form-input" value={form.postalCode} onChange={(e) => updateForm('postalCode', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Contacto de emergencia</label>
                <input className="form-input" value={form.emergencyContact} onChange={(e) => updateForm('emergencyContact', e.target.value)} placeholder="Nombre" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tel. emergencia</label>
                <input className="form-input" value={form.emergencyPhone} onChange={(e) => updateForm('emergencyPhone', e.target.value)} />
              </div>
            </div>
          </section>

          {/* 3. Membresía */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              3. Membresía y disciplinas
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Categoría club *</label>
                <select className="form-input" value={form.tier} onChange={(e) => updateForm('tier', e.target.value)}>
                  <option value="gold">Gold (Estándar)</option>
                  <option value="platinum">Platinum (VIP)</option>
                  <option value="royal">Royal (Exclusivo)</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Estado</label>
                <select className="form-input" value={form.status} onChange={(e) => updateForm('status', e.target.value)}>
                  <option value="active">Activo</option>
                  <option value="pending">Pendiente de aprobación</option>
                  <option value="suspended">Suspendido</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Fecha de ingreso</label>
                <input type="date" className="form-input" value={form.joinDate} onChange={(e) => updateForm('joinDate', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Próximo vencimiento de cuota</label>
                <input type="date" className="form-input" value={form.nextDueDate} onChange={(e) => updateForm('nextDueDate', e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: '0.85rem' }}>
              <label className="form-label">Disciplinas *</label>
              <p style={{ margin: '0.2rem 0 0.45rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Requisito de alta: indique al menos una disciplina en la que participará el titular.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginTop: 4 }}>
                {DISCIPLINE_OPTIONS.map((d) => {
                  const active = form.disciplines.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDiscipline(d)}
                      style={{
                        padding: '0.35rem 0.75rem',
                        borderRadius: 20,
                        border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                        background: active ? 'rgba(207,161,58,0.15)' : 'var(--bg-tertiary)',
                        color: active ? 'var(--text-gold)' : 'var(--text-secondary)',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 4. Facturación */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              4. Facturación y cobranza
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Razón social / facturación</label>
                <input className="form-input" value={form.billingName} onChange={(e) => updateForm('billingName', e.target.value)} placeholder="Si difiere del titular" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">CUIT / CUIL</label>
                <input className="form-input" value={form.cuitCuil} onChange={(e) => updateForm('cuitCuil', e.target.value)} placeholder="XX-XXXXXXXX-X" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Condición IVA</label>
                <select className="form-input" value={form.taxCondition} onChange={(e) => updateForm('taxCondition', e.target.value)}>
                  <option value="consumidor_final">Consumidor final</option>
                  <option value="monotributo">Monotributo</option>
                  <option value="ri">Responsable inscripto</option>
                  <option value="exento">Exento</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Medio de pago habitual</label>
                <select className="form-input" value={form.paymentMethod} onChange={(e) => updateForm('paymentMethod', e.target.value)}>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo en sede</option>
                  <option value="debito">Débito automático</option>
                  <option value="tarjeta">Tarjeta</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: '0.9rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.chargeFirstDues}
                  onChange={(e) => updateForm('chargeFirstDues', e.target.checked)}
                />
                Generar primera cuota al alta
                <strong style={{ color: 'var(--text-gold)' }}>({formatCurrency(duesPreview)})</strong>
              </label>
              {form.chargeFirstDues && (
                <div style={{
                  marginTop: '0.65rem',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 10,
                  border: '1px solid var(--border-glass)',
                  background: 'rgba(255,255,255,0.02)',
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                    <span>Titular ({form.tier})</span>
                    <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(duesBreakdown.titular)}</span>
                  </div>
                  {duesBreakdown.family.map((f) => (
                    <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                      <span>+ {f.name}</span>
                      <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(f.amount)}</span>
                    </div>
                  ))}
                  {form.familyGroup.length > 0 && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: '1px solid var(--border-glass)',
                      fontWeight: 700,
                      color: 'var(--text-gold)',
                    }}>
                      <span>Total grupo familiar</span>
                      <span>{formatCurrency(duesBreakdown.total)}</span>
                    </div>
                  )}
                  {form.familyGroup.length === 0 && (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Al sumar integrantes del grupo familiar, la cuota se actualiza sola.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 5. Grupo familiar */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <div>
                <h5 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                  5. Grupo familiar
                </h5>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Adherentes del titular (cónyuge, hijos, etc.). Opcional; también se pueden sumar después.
                  {form.chargeFirstDues && (
                    <> Cada integrante suma a la cuota: <strong style={{ color: 'var(--text-gold)' }}>{formatCurrency(duesPreview)}</strong></>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={addFamilyMember}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Users size={14} /> Sumar integrante
              </button>
            </div>

            {form.familyGroup.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                Sin integrantes. Use “Sumar integrante” para cargar el grupo familiar.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {form.familyGroup.map((row, index) => (
                  <div
                    key={row.id || index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '0.65rem',
                      padding: '0.85rem',
                      border: '1px solid var(--border-glass)',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ gridColumn: '1 / -1' }}>
                      <PhotoPicker
                        value={row.photo}
                        onChange={(photo) => updateFamilyMember(index, 'photo', photo)}
                        label="Foto del adherente"
                        size={72}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                      <label className="form-label">Nombre completo *</label>
                      <input
                        className="form-input"
                        value={row.name}
                        onChange={(e) => updateFamilyMember(index, 'name', e.target.value)}
                        placeholder="Apellido y nombres"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Vínculo</label>
                      <select
                        className="form-input"
                        value={row.relationship}
                        onChange={(e) => updateFamilyMember(index, 'relationship', e.target.value)}
                      >
                        {RELATIONSHIP_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">DNI</label>
                      <input
                        className="form-input"
                        value={row.documentNumber}
                        onChange={(e) => updateFamilyMember(index, 'documentNumber', e.target.value)}
                        placeholder="Sin puntos"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Nacimiento</label>
                      <input
                        type="date"
                        className="form-input"
                        value={row.birthDate}
                        onChange={(e) => updateFamilyMember(index, 'birthDate', e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Categoría</label>
                      <select
                        className="form-input"
                        value={row.tier}
                        onChange={(e) => updateFamilyMember(index, 'tier', e.target.value)}
                      >
                        <option value="gold">Gold</option>
                        <option value="platinum">Platinum</option>
                        <option value="royal">Royal</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                      <label className="form-label">Disciplinas *</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: 4 }}>
                        {DISCIPLINE_OPTIONS.map((d) => {
                          const active = (row.disciplines || []).includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => toggleFamilyDiscipline(index, d)}
                              style={{
                                padding: '0.3rem 0.65rem',
                                borderRadius: 20,
                                border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                                background: active ? 'rgba(207,161,58,0.15)' : 'var(--bg-tertiary)',
                                color: active ? 'var(--text-gold)' : 'var(--text-secondary)',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => removeFamilyMember(index)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#f87171' }}
                        aria-label="Quitar integrante"
                      >
                        <Trash2 size={14} /> Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6. Notas */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              6. Observaciones
            </h5>
            <textarea
              className="form-input"
              rows={3}
              value={form.notes}
              onChange={(e) => updateForm('notes', e.target.value)}
              placeholder="Notas internas de secretaría, condiciones especiales, etc."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </section>

          {formError && (
            <p style={{ color: '#ef4444', margin: 0, fontSize: '0.88rem' }}>{formError}</p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setShowAddForm(false); }}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 180, justifyContent: 'center' }}>
              <UserPlus size={16} />
              {form.familyGroup.length > 0
                ? `Registrar socio + ${form.familyGroup.length} familiar${form.familyGroup.length > 1 ? 'es' : ''}`
                : 'Registrar socio'}
            </button>
          </div>
        </form>
      )}

      {/* Tabla de Socios */}
      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Socio Titular</th>
              <th>Credencial ID</th>
              <th>Categoría</th>
              <th>Contacto</th>
              <th>Cuota / Saldo</th>
              <th style={{ textAlign: 'right' }}>Acciones Administrativas</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map(m => (
              <React.Fragment key={m.memberId}>
                <tr>
                  <td>
                    <div className="member-profile-cell">
                      <button
                        onClick={() => setExpandedMemberId(expandedMemberId === m.memberId ? null : m.memberId)}
                        style={{ background: 'none', border: 'none', color: 'var(--primary-gold)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.2rem' }}
                        title="Grupo familiar"
                        type="button"
                      >
                        {expandedMemberId === m.memberId ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenProfile?.(m.memberId)}
                        title="Ver perfil del socio"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit',
                          color: 'inherit',
                        }}
                      >
                        <div className="member-avatar" style={{ overflow: 'hidden', padding: 0 }}>
                          {m.photo ? (
                            <img src={m.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            m.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
                          )}
                        </div>
                        <div>
                          <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem', textDecoration: 'underline', textDecorationColor: 'rgba(207,161,58,0.35)', textUnderlineOffset: 3 }}>
                            {m.name}
                          </strong>
                          <div style={{ fontSize: '0.75rem', color: m.status === 'active' ? 'var(--emerald-accent)' : 'var(--text-muted)' }}>
                            {m.status === 'active' ? '● Cuenta Habilitada' : '○ Cuenta Suspendida'}
                            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· Ver perfil</span>
                          </div>
                        </div>
                      </button>
                    </div>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {m.memberId.replace(/(\d{4})/g, '$1 ').trim()}
                  </td>
                  <td>
                    <span className={`badge-tier ${m.tier.toLowerCase()}`}>
                      {m.tier}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {m.phone || 'Sin registrar'}
                  </td>
                  <td>
                    <span style={{
                      fontWeight: '600',
                      color: m.outstandingBalance > 0 ? 'var(--warning-accent)' : 'var(--emerald-accent)'
                     }}>
                      {m.outstandingBalance > 0 ? formatCurrency(m.outstandingBalance) : 'Al Día'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setCardMember(m)}
                        className="btn btn-secondary btn-sm"
                        style={{
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.75rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          borderColor: 'var(--primary-gold)',
                          color: 'var(--text-gold)',
                          background: 'rgba(207,161,58,0.06)',
                        }}
                        title="Ver tarjeta virtual"
                      >
                        <CreditCard size={12} /> Tarjeta
                      </button>
                      {m.outstandingBalance > 0 && (
                        <button
                          onClick={() => setCollectMember(m)}
                          className="btn btn-secondary btn-sm"
                          style={{
                            borderColor: 'var(--emerald-accent)',
                            color: 'var(--emerald-accent)',
                            background: 'rgba(16, 185, 129, 0.03)',
                            padding: '0.35rem 0.65rem'
                          }}
                          title="Cobrar Cuota Pendiente"
                        >
                          <Check size={12} /> Cobrar
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setMembers(members.map(item => {
                            if (item.memberId === m.memberId) {
                                return { ...item, status: item.status === 'active' ? 'suspended' : 'active' };
                            }
                            return item;
                          }));
                        }}
                        className="btn btn-danger btn-sm"
                        style={{
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.75rem',
                          background: m.status === 'active' ? 'rgba(239, 68, 68, 0.03)' : 'rgba(16, 185, 129, 0.03)',
                          borderColor: m.status === 'active' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: m.status === 'active' ? 'var(--danger-accent)' : 'var(--emerald-accent)'
                        }}
                      >
                        {m.status === 'active' ? 'Suspender' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Fila Expandida de Adherentes Familiares */}
                {expandedMemberId === m.memberId && (
                  <tr>
                    <td colSpan="6" style={{ padding: '0 0.5rem 1rem 0.5rem' }}>
                      <div className="adherents-subtable-box">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.4rem' }}>
                          <h5 className="serif-font" style={{ fontSize: '1rem', color: 'var(--text-gold)', display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                            <Users size={14} /> Grupo Familiar de {m.name}
                          </h5>
                          <button
                            onClick={() => setShowAddAdherentId(showAddAdherentId === m.memberId ? null : m.memberId)}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                          >
                            <UserPlus size={12} /> Agregar Adherente
                          </button>
                        </div>

                        {/* Formulario de Adherente */}
                        {showAddAdherentId === m.memberId && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                            <PhotoPicker
                              value={adhPhoto}
                              onChange={setAdhPhoto}
                              label="Foto del adherente"
                              size={64}
                            />
                            <div className="adh-add-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 100px', gap: '0.75rem', alignItems: 'end' }}>
                              <style>{`@media (max-width: 700px) { .adh-add-grid { grid-template-columns: 1fr !important; } }`}</style>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Nombre Completo</label>
                                <input
                                  type="text"
                                  className="form-input"
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  placeholder="Nombre del familiar"
                                  value={adhName}
                                  onChange={(e) => setAdhName(e.target.value)}
                                />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Parentesco</label>
                                <select
                                  className="form-input"
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  value={adhRelationship}
                                  onChange={(e) => setAdhRelationship(e.target.value)}
                                >
                                  {RELATIONSHIP_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                  <option value="Adherente Deportivo">Adherente Deportivo</option>
                                </select>
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Categoría</label>
                                <select
                                  className="form-input"
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  value={adhTier}
                                  onChange={(e) => setAdhTier(e.target.value)}
                                >
                                  <option value="gold">Gold</option>
                                  <option value="platinum">Platinum</option>
                                  <option value="royal">Royal</option>
                                </select>
                              </div>
                              <button
                                onClick={() => handleAddAdherent(m.memberId)}
                                className="btn btn-primary btn-sm"
                                style={{ padding: '0.45rem', width: '100%', fontSize: '0.8rem' }}
                                disabled={!adhName.trim() || !adhDisciplines.length}
                              >
                                Cargar
                              </button>
                            </div>
                            <div>
                              <label className="form-label" style={{ fontSize: '0.7rem' }}>Disciplinas *</label>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: 4 }}>
                                {DISCIPLINE_OPTIONS.map((d) => {
                                  const active = adhDisciplines.includes(d);
                                  return (
                                    <button
                                      key={d}
                                      type="button"
                                      onClick={() => setAdhDisciplines((prev) =>
                                        prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
                                      )}
                                      style={{
                                        padding: '0.25rem 0.55rem',
                                        borderRadius: 16,
                                        border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                                        background: active ? 'rgba(207,161,58,0.15)' : 'var(--bg-tertiary)',
                                        color: active ? 'var(--text-gold)' : 'var(--text-secondary)',
                                        fontSize: '0.72rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                      }}
                                    >
                                      {d}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Listado de adherentes */}
                        {!m.adherents || m.adherents.length === 0 ? (
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', margin: '0.5rem 0' }}>
                            No posee adherentes registrados actualmente.
                          </p>
                        ) : (
                          <div className="table-responsive">
                          <table className="admin-table" style={{ background: 'transparent' }}>
                            <thead>
                              <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Familiar</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Parentesco</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Disciplinas</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Nivel</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Estado Credencial</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem', textAlign: 'right' }}>Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.adherents.map(adh => (
                                <tr key={adh.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: '50%',
                                        overflow: 'hidden',
                                        flexShrink: 0,
                                        background: 'rgba(207,161,58,0.12)',
                                        border: '1px solid var(--border-glass)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '0.65rem',
                                        fontWeight: 700,
                                        color: 'var(--text-gold)',
                                      }}>
                                        {adh.photo ? (
                                          <img src={adh.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                          (adh.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                                        )}
                                      </div>
                                      <strong>{adh.name}</strong>
                                    </div>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem', color: 'var(--text-secondary)' }}>{adh.relationship}</td>
                                  <td style={{ fontSize: '0.75rem', padding: '0.4rem', color: 'var(--text-secondary)' }}>
                                    {(adh.disciplines || []).length ? adh.disciplines.join(', ') : '—'}
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                    <span className={`badge-tier ${adh.tier}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem' }}>
                                      {adh.tier}
                                    </span>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                    <span style={{ color: adh.status === 'active' ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                                      {adh.status === 'active' ? '● Activo' : '○ Suspendido'}
                                    </span>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem', textAlign: 'right' }}>
                                    <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                                      <button
                                        onClick={() => handleToggleAdherentStatus(m.memberId, adh.id)}
                                        className="btn btn-secondary btn-sm"
                                        style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                                      >
                                        {adh.status === 'active' ? 'Suspender' : 'Habilitar'}
                                      </button>
                                      <button
                                        onClick={() => handleDeleteAdherent(m.memberId, adh.id)}
                                        className="btn btn-danger btn-sm"
                                        style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {collectMember && (
        <CollectDuesModal
          member={collectMember}
          formatCurrency={formatCurrency}
          onClose={() => setCollectMember(null)}
          onConfirm={handleConfirmCollect}
        />
      )}

      {cardMember && (
        <div className="modal-overlay" onClick={() => setCardMember(null)}>
          <div
            className="modal-content glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '90%',
              maxWidth: 420,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-glass)',
              padding: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h4 className="serif-font" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-gold)' }}>
                  Tarjeta virtual
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {cardMember.name}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCardMember(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <X size={14} /> Cerrar
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <VirtualCard member={cardMember} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
