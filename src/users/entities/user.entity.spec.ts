import { User, Gender, REQUIRED_PROFILE_FIELDS } from './user.entity';

/**
 * The completeness rule gates borrowing, so it needs to be exact: too strict
 * and members are locked out, too loose and the details never get collected.
 */

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'u1';
  user.name = 'Ada Lovelace';
  user.email = 'ada@example.com';
  user.phone = '5551234567';
  user.address = '12 Analytical Way';
  user.dateOfBirth = '1990-05-21';
  user.gender = Gender.FEMALE;
  user.occupation = 'Mathematician';
  user.photoPath = '/uploads/photos/user-u1-1.jpg';
  return Object.assign(user, overrides);
}

describe('User profile completeness', () => {
  it('is complete when every required field is filled in', () => {
    const user = buildUser();
    expect(user.missingProfileFields).toEqual([]);
    expect(user.profileComplete).toBe(true);
  });

  it.each(REQUIRED_PROFILE_FIELDS.map(field => [field]))(
    'is incomplete when %s is null',
    (field) => {
      const user = buildUser({ [field]: null } as any);
      expect(user.profileComplete).toBe(false);
      expect(user.missingProfileFields.length).toBe(1);
    },
  );

  it('is incomplete when a field is undefined', () => {
    const user = buildUser({ occupation: undefined });
    expect(user.profileComplete).toBe(false);
  });

  it('treats a whitespace-only value as missing', () => {
    const user = buildUser({ occupation: '   ' });
    expect(user.profileComplete).toBe(false);
    expect(user.missingProfileFields).toContain('Occupation');
  });

  it('accepts "prefer not to say" as an answer for gender', () => {
    // The requirement is that the question was answered, not which answer.
    const user = buildUser({ gender: Gender.PREFER_NOT_TO_SAY });
    expect(user.profileComplete).toBe(true);
  });

  it('reports every outstanding field at once', () => {
    const user = buildUser({ dateOfBirth: null, occupation: null, photoPath: null });
    expect(user.missingProfileFields.sort()).toEqual(
      ['Date of birth', 'Occupation', 'Profile photo'].sort(),
    );
  });

  it('reports human-readable labels rather than column names', () => {
    const user = buildUser({ photoPath: null, dateOfBirth: null });
    expect(user.missingProfileFields).not.toContain('photoPath');
    expect(user.missingProfileFields).toContain('Profile photo');
  });

  it('a brand new account is incomplete', () => {
    const user = new User();
    user.name = 'New Member';
    user.email = 'new@example.com';
    expect(user.profileComplete).toBe(false);
    // Email is not part of the requirement; name is already set.
    expect(user.missingProfileFields).toEqual(
      ['Phone number', 'Address', 'Date of birth', 'Gender', 'Occupation', 'Profile photo'],
    );
  });
});
