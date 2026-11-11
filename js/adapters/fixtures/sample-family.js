// Dev-only demo data for the ?store=fixture demo store.
// Shipped as an ES module rather than .json: browsers reject a static JSON
// import without an import attribute, and CI is pinned to Node 20, which
// cannot parse `with` attributes. Same array, no loader requirements.
export default [
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-person-ada',
        '@type': 'Person',
        'label': 'Ada Gordon'
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-person-george',
        '@type': 'Person',
        'label': 'George Gordon'
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-person-anne',
        '@type': 'Person',
        'label': 'Anne Milbanke'
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-record-certificate',
        '@type': 'Record',
        'label': 'Parish baptism certificate, 1815'
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-record-census',
        '@type': 'Record',
        'label': 'Census return, 1851'
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-event-ada-birth',
        '@type': ['Event', 'https://cubap.github.io/Genealogger/nv#Birth'],
        'label': 'Birth of Ada Gordon'
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-anno-label',
        'type': 'Annotation',
        'target': 'https://devstore.rerum.io/v1/id/fixture-person-ada',
        'body': {
            'label': {
                'value': 'Ada Gordon',
                'source': { 'citationSource': 'Parish baptism certificate, 1815' },
                'evidence': 'https://devstore.rerum.io/v1/id/fixture-record-certificate',
                'https://cubap.github.io/Genealogger/nv#confidence': 0.95
            }
        }
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-anno-birthdate-certificate',
        'type': 'Annotation',
        'target': 'https://devstore.rerum.io/v1/id/fixture-person-ada',
        'body': {
            'https://schema.org/birthDate': {
                'value': '1815-12-10',
                'source': { 'citationSource': 'Parish baptism certificate, 1815' },
                'evidence': 'https://devstore.rerum.io/v1/id/fixture-record-certificate',
                'https://cubap.github.io/Genealogger/nv#confidence': 0.95
            }
        }
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-anno-birthdate-census',
        'type': 'Annotation',
        'target': 'https://devstore.rerum.io/v1/id/fixture-person-ada',
        'body': {
            'https://schema.org/birthDate': {
                'value': '1817',
                'source': {
                    'citationSource': 'Census return, 1851',
                    'comment': 'Census ages are commonly misstated; kept for the conflict.'
                },
                'evidence': 'https://devstore.rerum.io/v1/id/fixture-record-census',
                'https://cubap.github.io/Genealogger/nv#confidence': 0.3
            }
        }
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-anno-participation-child',
        'type': 'Annotation',
        'target': 'https://devstore.rerum.io/v1/id/fixture-event-ada-birth',
        'body': {
            'https://cubap.github.io/Genealogger/nv#participant': {
                'value': 'https://devstore.rerum.io/v1/id/fixture-person-ada',
                'evidence': 'https://devstore.rerum.io/v1/id/fixture-record-certificate'
            },
            'https://cubap.github.io/Genealogger/nv#role': {
                'value': 'https://cubap.github.io/Genealogger/nv#child'
            }
        }
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-anno-participation-mother',
        'type': 'Annotation',
        'target': 'https://devstore.rerum.io/v1/id/fixture-event-ada-birth',
        'body': {
            'https://cubap.github.io/Genealogger/nv#participant': {
                'value': 'https://devstore.rerum.io/v1/id/fixture-person-anne',
                'evidence': 'https://devstore.rerum.io/v1/id/fixture-record-certificate'
            },
            'https://cubap.github.io/Genealogger/nv#role': {
                'value': 'https://cubap.github.io/Genealogger/nv#parent'
            }
        }
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-anno-hasparent-mother',
        'type': 'Annotation',
        'target': 'https://devstore.rerum.io/v1/id/fixture-person-ada',
        'body': {
            'https://cubap.github.io/Genealogger/nv#hasParent': {
                'value': 'https://devstore.rerum.io/v1/id/fixture-person-anne',
                'evidence': 'https://devstore.rerum.io/v1/id/fixture-event-ada-birth',
                'https://cubap.github.io/Genealogger/nv#confidence': 0.95
            }
        }
    },
    {
        '@id': 'https://devstore.rerum.io/v1/id/fixture-anno-lacuna-father',
        'type': 'Annotation',
        'target': 'https://devstore.rerum.io/v1/id/fixture-person-ada',
        'body': {
            'https://cubap.github.io/Genealogger/nv#Lacuna': {
                'value': 'father not named on the certificate',
                'source': { 'citationNote': 'expected slot: nv#hasParent via certificate' },
                'evidence': 'https://devstore.rerum.io/v1/id/fixture-record-certificate'
            }
        }
    }
]
