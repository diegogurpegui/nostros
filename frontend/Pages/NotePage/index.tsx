import React, { useCallback, useContext, useEffect, useState } from 'react'
import { AppContext } from '../../Contexts/AppContext'
import { getNotes, Note } from '../../Functions/DatabaseFunctions/Notes'
import { RelayPoolContext } from '../../Contexts/RelayPoolContext'
import NoteCard from '../../Components/NoteCard'
import { EventKind } from '../../lib/nostr/Events'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Event } from '../../../lib/nostr/Events'
import { getDirectReplies, getReplyEventId } from '../../Functions/RelayFunctions/Events'
import { RelayFilters } from '../../lib/nostr/RelayPool/intex'
import { getUser, User } from '../../Functions/DatabaseFunctions/Users'
import { ActivityIndicator, Button, IconButton, Surface, useTheme } from 'react-native-paper'
import { npubEncode } from 'nostr-tools/nip19'
import moment from 'moment'
import { usernamePubKey } from '../../Functions/RelayFunctions/Users'
import NostrosAvatar from '../../Components/Avatar'
import TextContent from '../../Components/TextContent'
import { getReactionsCount, getUserReaction } from '../../Functions/DatabaseFunctions/Reactions'
import { UserContext } from '../../Contexts/UserContext'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import RBSheet from 'react-native-raw-bottom-sheet'
import ProfileCard from '../../Components/ProfileCard'

interface NotePageProps {
  route: { params: { noteId: string } }
}

export const NotePage: React.FC<NotePageProps> = ({ route }) => {
  const { database } = useContext(AppContext)
  const { publicKey, privateKey } = useContext(UserContext)
  const { relayPool, lastEventId } = useContext(RelayPoolContext)
  const [note, setNote] = useState<Note>()
  const [replies, setReplies] = useState<Note[]>()
  const [eventId, setEventId] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [nPub, setNPub] = useState<string>()
  const [positiveReactions, setPositiveReactions] = useState<number>(0)
  const [negaiveReactions, setNegativeReactions] = useState<number>(0)
  const [userUpvoted, setUserUpvoted] = useState<boolean>(false)
  const [userDownvoted, setUserDownvoted] = useState<boolean>(false)
  const [timestamp, setTimestamp] = useState<string>()
  const [profileCardPubkey, setProfileCardPubKey] = useState<string>()
  const theme = useTheme()
  const bottomSheetProfileRef = React.useRef<RBSheet>(null)

  useEffect(() => {
    relayPool?.unsubscribeAll()
    setNote(undefined)
    setReplies(undefined)
    setEventId(route.params.noteId)
    subscribeNotes()
    loadNote()
  }, [])

  useEffect(() => {
    if (database && publicKey && note?.id) {
      getReactionsCount(database, { positive: true, eventId: note.id }).then((result) => {
        setPositiveReactions(result ?? 0)
      })
      getReactionsCount(database, { positive: false, eventId: note.id }).then((result) => {
        setNegativeReactions(result ?? 0)
      })
      getUserReaction(database, publicKey, { eventId: note.id }).then((results) => {
        results.forEach((reaction) => {
          if (reaction.positive) {
            setUserUpvoted(true)
          } else {
            setUserDownvoted(true)
          }
        })
      })
    }
  }, [lastEventId])

  useEffect(() => {
    loadNote()
  }, [eventId, lastEventId])

  const loadNote: () => void = async () => {
    if (database) {
      const events = await getNotes(database, { filters: { id: route.params.noteId } })
      const event = events[0]
      setNote(event)
      setNPub(npubEncode(event.pubkey))
      setTimestamp(moment.unix(event.created_at).format('HH:mm DD-MM-YY'))

      const notes = await getNotes(database, { filters: { reply_event_id: route.params.noteId } })
      const rootReplies = getDirectReplies(event, notes)
      if (rootReplies.length > 0) {
        setReplies(rootReplies as Note[])
        const message: RelayFilters = {
          kinds: [EventKind.meta],
          authors: [...rootReplies.map((note) => note.pubkey), event.pubkey],
        }
        relayPool?.subscribe('meta-notepage', [message])
      } else {
        setReplies([])
      }
      getUser(event.pubkey, database).then((user) => {
        if (user) {
          setUser(user)
        }
      })
      setRefreshing(false)
    }
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    relayPool?.unsubscribeAll()
    subscribeNotes()
    loadNote()
  }, [])

  const subscribeNotes: (past?: boolean) => Promise<void> = async (past) => {
    if (database && route.params.noteId) {
      relayPool?.subscribe('notepage', [
        {
          kinds: [EventKind.textNote],
          ids: [route.params.noteId],
        },
        {
          kinds: [EventKind.reaction, EventKind.textNote],
          '#e': [route.params.noteId],
        },
      ])
    }
  }

  const publishReaction: (positive: boolean) => void = (positive) => {
    if (note) {
      const event: Event = {
        content: positive ? '+' : '-',
        created_at: moment().unix(),
        kind: EventKind.reaction,
        pubkey: publicKey,
        tags: [...note.tags, ['e', note.id], ['p', note.pubkey]],
      }
      relayPool?.sendEvent(event)
    }
  }

  const renderItem: (note: Note) => JSX.Element = (note) => (
    <View style={[styles.noteCard, { borderColor: theme.colors.onSecondary }]} key={note.id}>
      <NoteCard
        note={note}
        onPressOptions={() => {
          setProfileCardPubKey(note.pubkey)
          bottomSheetProfileRef.current?.open()
        }}
      />
    </View>
  )

  const bottomSheetStyles = React.useMemo(() => {
    return {
      container: {
        backgroundColor: theme.colors.background,
        padding: 16,
        borderTopRightRadius: 28,
        borderTopLeftRadius: 28,
      },
      draggableIcon: {
        backgroundColor: '#000',
      },
    }
  }, [])

  return note && nPub ? (
    <View style={styles.content}>
      <Surface elevation={1}>
        <View style={styles.title}>
          <View style={styles.titleUser}>
            <View>
              <NostrosAvatar
                name={note.name}
                pubKey={nPub}
                src={note.picture}
                lud06={note.lnurl}
                size={54}
              />
            </View>
            <View>
              <Text>{usernamePubKey(note.name, nPub)}</Text>
              <Text>{timestamp}</Text>
            </View>
          </View>
          <View>
            <IconButton
              icon='dots-vertical'
              size={25}
              onPress={() => {
                setProfileCardPubKey(publicKey)
                bottomSheetProfileRef.current?.open()
              }}
            />
          </View>
        </View>
        <View style={[styles.titleContent, { borderColor: theme.colors.onSecondary }]}>
          <TextContent event={note} />
        </View>
        {privateKey && (
          <View style={[styles.titleContent, { borderColor: theme.colors.onSecondary }]}>
            <Button
              onPress={() => {
                if (!userDownvoted && privateKey) {
                  setUserDownvoted(true)
                  setNegativeReactions((prev) => prev + 1)
                  publishReaction(false)
                }
              }}
              icon={() => <MaterialCommunityIcons name='thumb-down-outline' size={25} />}
            >
              {negaiveReactions === undefined || negaiveReactions === 0 ? '-' : negaiveReactions}
            </Button>
            <Button
              onPress={() => {
                if (!userUpvoted && privateKey) {
                  setUserUpvoted(true)
                  setPositiveReactions((prev) => prev + 1)
                  publishReaction(true)
                }
              }}
              icon={() => <MaterialCommunityIcons name='thumb-up-outline' size={25} />}
            >
              {positiveReactions === undefined || positiveReactions === 0 ? '-' : positiveReactions}
            </Button>
          </View>
        )}
      </Surface>
      {replies && replies.length > 0 && (
        <ScrollView
          horizontal={false}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          style={styles.list}
        >
          {replies.map((note) => renderItem(note))}
          {replies.length >= 10 && <ActivityIndicator style={styles.loading} animating={true} />}
        </ScrollView>
      )}
      <RBSheet
        ref={bottomSheetProfileRef}
        closeOnDragDown={true}
        height={280}
        customStyles={bottomSheetStyles}
      >
        <ProfileCard userPubKey={profileCardPubkey ?? ''} bottomSheetRef={bottomSheetProfileRef} />
      </RBSheet>
    </View>
  ) : (
    <></>
  )
}

const styles = StyleSheet.create({
  title: {
    paddingRight: 16,
    paddingLeft: 16,
    paddingTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignContent: 'center',
  },
  titleUser: {
    flexDirection: 'row',
    alignContent: 'center',
  },
  titleContent: {
    borderTopWidth: 1,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  list: {
    padding: 16,
  },
  loading: {
    paddingBottom: 60
  },
  noteCard: {
    borderLeftWidth: 1,
    paddingLeft: 32,
    paddingBottom: 16,
  },
})

export default NotePage
