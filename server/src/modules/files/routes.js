'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { get } = require('../../db');
const { requireAuth } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const config = require('../../config');
const { audit } = require('../platform/service');

const router = express.Router();
router.use('/files', requireAuth);

router.get('/files/:id', (req, res, next) => {
  try {
    const id = req.params.id;
    let fileMeta = null;
    let allowed = false;

    const reqFile = get('SELECT * FROM request_files WHERE id = ?', [id]);
    if (reqFile) {
      const sreq = get('SELECT id, user_id, code FROM service_requests WHERE id = ?', [reqFile.request_id]);
      if (!sreq) throw ApiError.notFound('پروندهٔ مرتبط یافت نشد.');
      const isOwner = sreq.user_id === req.user.id;
      const isStaff = ['operator', 'admin', 'support', 'finance'].includes(req.user.role);
      if (reqFile.kind === 'internal') {
        allowed = ['operator', 'admin'].includes(req.user.role);
      } else {
        allowed = isOwner || isStaff;
      }
      fileMeta = { ...reqFile, entity: 'service_request', entity_id: sreq.id };
    } else {
      const ticketFile = get('SELECT * FROM ticket_files WHERE id = ?', [id]);
      if (ticketFile) {
        const ticket = get('SELECT id, user_id FROM tickets WHERE id = ?', [ticketFile.ticket_id]);
        if (!ticket) throw ApiError.notFound('تیکت مرتبط یافت نشد.');
        const isOwner = ticket.user_id === req.user.id;
        const isStaff = ['support', 'admin'].includes(req.user.role);
        allowed = isOwner || isStaff;
        fileMeta = { ...ticketFile, entity: 'ticket', entity_id: ticket.id };
      }
    }

    if (!fileMeta) throw ApiError.notFound('فایل یافت نشد.');
    if (!allowed) throw ApiError.forbidden('شما مجوز دسترسی به این فایل خصوصی را ندارید.');

    const safeStored = path.basename(fileMeta.stored_name);
    const fullPath = path.join(config.storageDir, safeStored);
    if (!fs.existsSync(fullPath)) {
      throw ApiError.notFound('فایل روی ذخیره‌ساز یافت نشد.');
    }

    if (req.user.role !== 'customer') {
      audit(req.user.id, req.user.role, 'file.download', fileMeta.entity, fileMeta.entity_id, { file_id: id });
    }

    const encodedName = encodeURIComponent(fileMeta.original_name || 'file');
    res.setHeader('Content-Type', fileMeta.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodedName}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
