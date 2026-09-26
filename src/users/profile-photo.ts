import { BadRequestException } from '@nestjs/common';
import { env } from '../config/env';
import * as fs from 'fs';
import * as path from 'path';

const PHOTO_SUBDIRECTORY = 'photos';

export const PROFILE_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSION_BY_MIME: { [mime: string]: string } = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function photosDirectory(): string {
  return path.join(env.uploads.directory, PHOTO_SUBDIRECTORY);
}

/**
 * Resolves a stored photoPath to an absolute path.
 *
 * Only the basename is used, so a malformed or tampered value can never escape
 * the uploads directory.
 */
export function resolveProfilePhotoPath(photoPath: string): string | null {
  if (!photoPath) {
    return null;
  }
  const filename = path.basename(photoPath);
  if (!filename || filename === '.' || filename === '..') {
    return null;
  }
  return path.join(photosDirectory(), filename);
}

export function storeProfilePhoto(userId: string, file: Express.Multer.File): string {
  if (!file || !file.buffer) {
    throw new BadRequestException('No image was uploaded');
  }

  // The extension comes from the validated mime type, never from the client's
  // filename, so an upload cannot choose its own extension.
  const ext = EXTENSION_BY_MIME[file.mimetype];
  if (!ext) {
    throw new BadRequestException('Unsupported image type');
  }

  const directory = photosDirectory();
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const filename = `user-${userId}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(directory, filename), file.buffer);

  return `/${path.posix.join('uploads', PHOTO_SUBDIRECTORY, filename)}`;
}

export function deleteProfilePhoto(photoPath: string): void {
  const absolute = resolveProfilePhotoPath(photoPath);
  if (absolute && fs.existsSync(absolute)) {
    fs.unlinkSync(absolute);
  }
}

export function profilePhotoContentType(photoPath: string): string {
  const ext = path.extname(photoPath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}
